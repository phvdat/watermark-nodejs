const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const sharp = require('sharp');
const archiver = require('archiver');
const axios = require('axios');
var cors = require('cors')
require('dotenv').config();
const nameColumn = 'Name';
const imagesColumn = 'Images';


const app = express();
app.use(cors())
const upload = multer({ dest: 'uploads/' });

app.post('/process', upload.single('excelFile'), async (req, res) => {
	// const { logoUrl } = req.body;
	const { logoUrl, logoWidth, logoHeight, imageWidth, imageHeight, quality } = req.body;
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
				const imageName = `${name.replaceAll(" ", "-")}-${Date.now()}.webp`;
				const imagePath = `${folderPath}/${imageName}`;

				try {
					// Download the image from the URL
					const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });

					// Composite the logo onto the image as a watermark
					const logoBuffer = await axios.get(logoUrl, { responseType: 'arraybuffer' });

					const logoImage = sharp(logoBuffer.data);
					const originalImage = sharp(response.data);

					// Get the dimensions of the logo and the original image
					const logoMetadata = await logoImage.metadata();
					const originalMetadata = await originalImage.metadata();

					const processedImageBuffer = await originalImage
						.resize(Number(imageWidth), Number(imageHeight)) // Resize the original image
						.composite([{ input: await logoImage.resize(Number(logoWidth), Number(logoHeight)).toBuffer() }]) // Resize and composite the logo
						.webp({ quality: Number(quality) })
						.toBuffer();

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
			res.json({ downloadLink: `${process.env.REACT_APP_API_ENDPOINT}/${zipFileName}` });

			// Delete the uploaded Excel file and the images folder
			fs.unlinkSync(excelFile.path);
			deleteFolderRecursive(imagesFolderPath);
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
			fs.unlinkSync(zipFileName);
		}
	});
});

app.listen(process.env.PORT, () => {
	console.log('Server is running on port', process.env.PORT);
});