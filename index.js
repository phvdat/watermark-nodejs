const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const sharp = require('sharp');
const archiver = require('archiver');
const axios = require('axios');
var cors = require('cors')

const app = express();
app.use(cors())
const upload = multer({ dest: 'uploads/' });

app.post('/process', upload.single('excelFile'), async (req, res) => {
	// const { logoUrl } = req.body;
	const { logoUrl, logoWidth, logoHeight, imageWidth, imageHeight } = req.body;
	const excelFile = req.file;
	// Process the Excel file
	const workbook = xlsx.readFile(excelFile.path);
	const worksheet = workbook.Sheets[workbook.SheetNames[0]];
	const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

	// Create a directory to store the processed images
	const imagesFolderPath = 'images';
	fs.mkdirSync(imagesFolderPath, { recursive: true });
	try {
		for (const row of rows) {
			const name = row[1];
			const imageUrls = row[2].split(',');

			const folderPath = `${imagesFolderPath}/${name}`;
			fs.mkdirSync(folderPath, { recursive: true });

			for (let i = 0; i < imageUrls.length; i++) {
				const imageUrl = imageUrls[i];
				const imageName = `image${i + 1}.jpg`;
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
						.toBuffer();

					// Save the processed image
					fs.writeFileSync(imagePath, processedImageBuffer);
					console.log(`Added watermark to ${imagePath}`);
				} catch (error) {
					console.error(`Error downloading image: ${imageUrl}`);
					console.error(error);
				}
			}
		}

		// Create a ZIP file containing the processed images
		const output = fs.createWriteStream('images.zip');
		const archive = archiver('zip', { zlib: { level: 9 } });

		output.on('close', () => {
			console.log('Created ZIP file: images.zip');
			res.json({ downloadLink: 'http://localhost:8000/images.zip' });

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
		console.error('Error processing images:', error);
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

app.get('/images.zip', (req, res) => {
	const zipFilePath = 'images.zip';
	res.download(zipFilePath, (err) => {
		if (err) {
			console.error('Error downloading ZIP file:', err);
			res.status(500).json({ error: 'An error occurred while downloading the ZIP file.' });
		} else {
			console.log('ZIP file downloaded successfully');
		}
	});
});

app.listen(8000, () => {
	console.log('Server is running on port 8000');
});