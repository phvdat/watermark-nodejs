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
const addMetadata = require('./helper/addMetadata');

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
		shopName,
	} = req.body;
	const excelFile = req.file;

	// Process the Excel file
	const workbook = xlsx.readFile(excelFile.path, { type: 'array' });
	const worksheet = workbook.Sheets[workbook.SheetNames[0]];
	const rows = xlsx.utils.sheet_to_json(worksheet);
	const imagesFolderPath = `media/images-${Date.now()}`;
	fs.mkdirSync(imagesFolderPath, { recursive: true });
	const zipFileName = `images-${Date.now()}.zip`;
	const zipFilePath = `./media/${zipFileName}`;
	try {
		for (const row of rows) {
			const regex = /[^a-zA-Z0-9\s]/g;
			const nameOrigin = row[nameColumn];
			const name = nameOrigin.replace(regex, '');
			const imageUrls = row[imagesColumn].split(',');
			const folderPath = `${imagesFolderPath}/${name}`;
			fs.mkdirSync(folderPath, { recursive: true });

			for (let i = 0; i < imageUrls.length; i++) {
				const imageUrl = imageUrls[i];
				const imageName = `${name.replaceAll(' ', '-')}-${i + 1}.jpg`;
				const imagePath = `${folderPath}/${imageName}`;

				try {
					const response = await axios.get(imageUrl, {
						responseType: 'arraybuffer',
					});
					const logoResponse = await axios.get(logoUrl, {
						responseType: 'arraybuffer',
					});
					const resizedLogo = await sharp(logoResponse.data)
						.resize(Number(logoWidth), Number(logoHeight))
						.toBuffer();
					const buffer = await sharp(response.data)
						.resize(Number(imageWidth), Number(imageHeight))
						.composite([
							{
								input: resizedLogo,
								gravity: 'southeast',
							},
						])
						.jpeg({ quality: Number(quality) })
						.toBuffer();

					// Save the processed image
					fs.writeFileSync(imagePath, buffer);

					// Update EXIF metadata of the image
					addMetadata(name, shopName, imagePath);
				} catch (error) {
					console.error(error);
					continue;
				}
			}
		}

		const output = fs.createWriteStream(zipFilePath);
		const archive = archiver('zip', { zlib: { level: 9 } });
		output.on('close', () => {
			const downloadLink = `${process.env.REACT_APP_API_ENDPOINT}/${zipFileName}`;
			const message = `Click the link below to download the processed images:\n${downloadLink} \nLink will be expired in 5 hours`;
			bot
				.sendMessage(idTelegram, message)
				.then(() => {
					// fs.unlinkSync(excelFile.path);
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
		res.status(500);
		fs.unlinkSync(excelFile.path);
		deleteFolderRecursive(imagesFolderPath);
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

		// Check if the directory is empty after deleting all files and subdirectories
		const files = fs.readdirSync(folderPath);
		if (files.length === 0) {
			fs.rmdirSync(folderPath);
		} else {
			console.log(`Directory ${folderPath} is not empty.`);
		}
	}
}

app.get('/:zipFileName', (req, res) => {
	const zipFileName = req.params.zipFileName;
	res.download(`media/${zipFileName}`);
});

app.listen(process.env.PORT, () => {
	console.log('Server is running on port', process.env.PORT);
});
