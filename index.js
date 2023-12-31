const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const archiver = require('archiver');
const axios = require('axios');
const sharp = require('sharp');
var cors = require('cors');
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const piexif = require('piexifjs');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
const nameColumn = 'Name';
const imagesColumn = 'Images';

const app = express();
app.use(cors());
const upload = multer({ dest: 'uploads/' });

app.post('/process', upload.single('excelFile'), async (req, res) => {
  res.json({ processing: true });
  const {
    logoUrl,
    logoWidth,
    logoHeight,
    imageWidth,
    imageHeight,
    quality,
    idTelegram,
    shopName
  } = req.body;
  const excelFile = req.file;

  // Process the Excel file
  const workbook = xlsx.readFile(excelFile.path, { type: 'array' });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(worksheet);
  const imagesFolderPath = `media/images-${Date.now()}`;
  fs.mkdirSync(imagesFolderPath, { recursive: true });
  try {
    for (const row of rows) {
      const name = row[nameColumn];
      const imageUrls = row[imagesColumn].split(',');

      const folderPath = `${imagesFolderPath}/${name}`;
      fs.mkdirSync(folderPath, { recursive: true });

      for (let i = 0; i < imageUrls.length; i++) {
        const imageUrl = imageUrls[i];
        const imageName = `${name.replaceAll(' ', '-')}-${i + 1}.jpg`;
        const imagePath = `${folderPath}/${imageName}`;

        try {
          const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer'
          });
          const logoResponse = await axios.get(logoUrl, {
            responseType: 'arraybuffer'
          });
          const resizedLogo = await sharp(logoResponse.data)
            .resize(Number(logoWidth), Number(logoHeight))
            .toBuffer();
          const buffer = await sharp(response.data)
            .resize(Number(imageWidth), Number(imageHeight))
            .composite([
              {
                input: resizedLogo,
                gravity: 'southeast'
              }
            ])
            .jpeg({ quality: Number(quality) })
            .toBuffer();

          // Save the processed image
          fs.writeFileSync(imagePath, buffer);

          // Update EXIF metadata of the image
          const exifData = piexif.load(buffer.toString('binary'));

          exifData['0th'][piexif.ImageIFD.XPTitle] = [
            ...Buffer.from(name, 'ucs2')
          ];
          exifData['0th'][piexif.ImageIFD.XPSubject] = [
            ...Buffer.from(`Product picture of ${name}`, 'ucs2')
          ];
          exifData['0th'][piexif.ImageIFD.XPComment] = [
            ...Buffer.from(`Images ${i + 1} of ${name}`, 'ucs2')
          ];
          exifData['0th'][piexif.ImageIFD.ExifTag] = [
            ...Buffer.from(shopName, 'ucs2')
          ];
          exifData['0th'][piexif.ImageIFD.Rating] = 5;
          exifData['0th'][piexif.ImageIFD.XPAuthor] = [
            ...Buffer.from(shopName, 'ucs2')
          ];
          exifData['0th'][piexif.ImageIFD.Make] = 'Photographer of ' + shopName;
          exifData['0th'][piexif.ImageIFD.Model] = 'Model of ' + shopName;
          exifData['0th'][
            piexif.ImageIFD.Copyright
          ] = `Copyright ${new Date().getFullYear()} © ${shopName}`;
          exifData['0th'][piexif.ImageIFD.Software] = shopName;
          exifData['0th'][piexif.ImageIFD.ExifVersion] =
            piexif.ExifIFD[piexif.ImageIFD.ExifVersion];
          const updatedExifData = piexif.dump(exifData);

          const updatedImageBuffer = piexif.insert(
            updatedExifData,
            buffer.toString('binary')
          );
          fs.writeFileSync(
            imagePath,
            Buffer.from(updatedImageBuffer, 'binary')
          );
        } catch (error) {
          console.error(error);
        }
      }
    }

    const zipFileName = `images-${Date.now()}.zip`;
    const zipFilePath = `./media/${zipFileName}`;
    const output = fs.createWriteStream(zipFilePath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => {
      const downloadLink = `${process.env.REACT_APP_API_ENDPOINT}/${zipFileName}`; // Replace with your server's URL
      const message = `Click the link below to download the processed images:\n${downloadLink} \nLink will be expired in 5 hours`;
      bot
        .sendMessage(idTelegram, message)
        .then(() => {
          // Delete the uploaded Excel file and the images folder
          fs.unlinkSync(excelFile.path);
          deleteFolderRecursive(imagesFolderPath);
          const deletionTime = 5 * 60 * 60 * 1000; // 10 hours
          setTimeout(() => {
            fs.unlinkSync(zipFilePath);
          }, deletionTime);
        })
        .catch((error) => {
          console.error('Error sending download link to Telegram:', error);
          fs.unlinkSync(excelFile.path);
          deleteFolderRecursive(imagesFolderPath);
          fs.unlinkSync(zipFilePath);
        });
    });

    archive.on('error', (err) => {
      throw err;
    });

    archive.pipe(output);
    archive.directory(imagesFolderPath, false);
    archive.finalize();
  } catch (error) {
    res
      .status(500)
      .json({ error: 'An error occurred while processing the images.' });
    fs.unlinkSync(excelFile.path);
    deleteFolderRecursive(imagesFolderPath);
    fs.unlinkSync(zipFilePath);
  }
});

function deleteFolderRecursive(folderPath) {
  if (fs.existsSync(folderPath)) {
    fs.readdirSync(folderPath).forEach((file) => {
      const curPath = `${folderPath}/${file}`;
      if (fs.lstatSync(curPath).isDirectory()) {
        deleteFolderRecursive(curPath);
      } else {
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(folderPath);
  }
}

app.get('/:zipFileName', (req, res) => {
  const zipFileName = req.params.zipFileName;
  res.download(`media/${zipFileName}`, (err) => {
    if (err) {
      console.error('Error downloading ZIP file:', err);
      res
        .status(500)
        .json({ error: 'An error occurred while downloading the ZIP file.' });
    } else {
      // Delete the ZIP file after successful download
      // fs.unlinkSync(zipFilePath);
    }
  });
});

app.listen(process.env.PORT, () => {
  console.log('Server is running on port', process.env.PORT);
});
