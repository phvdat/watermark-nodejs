const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const archiver = require('archiver');
const axios = require('axios');
var cors = require('cors')
require('dotenv').config();
const Jimp = require('jimp');
const TelegramBot = require('node-telegram-bot-api');

// Create a new Telegram bot instance
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

const nameColumn = 'Name';
const imagesColumn = 'Images';


const app = express();
app.use(cors())
const upload = multer({ dest: 'uploads/' });

app.post('/process', upload.single('excelFile'), async (req, res) => {
	res.json({ processing: true });
	const { logoUrl, logoWidth, logoHeight, imageWidth, imageHeight, quality, idTelegram } = req.body;
	const excelFile = req.file;

	// Process the Excel file
	const workbook = xlsx.readFile(excelFile.path, { type: "array" });
	const worksheet = workbook.Sheets[workbook.SheetNames[0]];
	const rows = xlsx.utils.sheet_to_json(worksheet);
	// Create a directory to store the processed images
	const imagesFolderPath = `images-${Date.now()}`;
	fs.mkdirSync(imagesFolderPath, { recursive: true });
	try {
		for (const row of rows) {
			const name = row[nameColumn];
			const imageUrls = row[imagesColumn].split(',');

			const folderPath = `${imagesFolderPath}/${name}`;
			fs.mkdirSync(folderPath, { recursive: true });

			for (let i = 0; i < imageUrls.length; i++) {
				const imageUrl = imageUrls[i];
				const imageName = `${name.replaceAll(" ", "-")}-${Date.now()}.jpg`;
				const imagePath = `${folderPath}/${imageName}`;

				try {
					// Download the image from the URL
					const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });

					// Composite the logo onto the image as a watermark
					const logoBuffer = await axios.get(logoUrl, { responseType: 'arraybuffer' });

					const logoImage = await Jimp.read(logoBuffer.data);
					const originalImage = await Jimp.read(response.data);

					// Resize the original image
					originalImage.resize(Number(imageWidth), Number(imageHeight));

					// Resize and composite the logo
					logoImage.resize(Number(logoWidth), Number(logoHeight));
					originalImage.composite(logoImage, 0, 0);

					// Convert the image to WebP format with the specified quality
					const processedImageBuffer = await originalImage.quality(Number(quality)).getBufferAsync(Jimp.MIME_JPEG);

					// Save the processed image
					fs.writeFileSync(imagePath, processedImageBuffer);
				} catch (error) {
					console.error(error);
				}
			}
		}

		// Create a ZIP file containing the processed images

		const zipFileName = `images-${Date.now()}.zip`;
		const zipFilePath = `./${zipFileName}`;
		const output = fs.createWriteStream(zipFilePath);
		const archive = archiver('zip', { zlib: { level: 9 } });

		output.on('close', () => {
			const downloadLink = `${process.env.REACT_APP_API_ENDPOINT}/${zipFileName}`; // Replace with your server's URL
			const message = `Click the link below to download the processed images:\n${downloadLink}`;

			// Send the message with the download link to Telegram
			bot.sendMessage(idTelegram, message)
				.then(() => {
					// Delete the uploaded Excel file and the images folder
					fs.unlinkSync(excelFile.path);
					deleteFolderRecursive(imagesFolderPath);
				})
				.catch((error) => {
					console.error('Error sending download link to Telegram:', error);
					fs.unlinkSync(excelFile.path);
					deleteFolderRecursive(imagesFolderPath);
				});
		});

		archive.on('error', (err) => {
			throw err;
		});

		archive.pipe(output);
		archive.directory(imagesFolderPath, false);
		archive.finalize();

	} catch (error) {
		res.status(500).json({ error: 'An error occurred while processing the images.' });
	}
});

function deleteFolderRecursive(folderPath) {
	if (fs.existsSync(folderPath)) {
		fs.readdirSync(folderPath).forEach((file) => {
			const curPath = `${folderPath}/${file}`;
			if (fs.lstatSync(curPath).isDirectory()) {
				deleteFolderRecursive(curPath); // Recursively delete subdirectories
			} else {
				fs.unlinkSync(curPath); // Delete files
			}
		});
		fs.rmdirSync(folderPath); // Delete the directory itself
	}
}

app.get('/:zipFileName', (req, res) => {
	const zipFileName = req.params.zipFileName;
	res.download(zipFileName, (err) => {
		if (err) {
			console.error('Error downloading ZIP file:', err);
			res.status(500).json({ error: 'An error occurred while downloading the ZIP file.' });
		} else {
			// Delete the ZIP file after successful download
			// fs.unlinkSync(zipFileName);
		}
	});
});

app.listen(process.env.PORT, () => {
	console.log('Server is running on port', process.env.PORT);
});
