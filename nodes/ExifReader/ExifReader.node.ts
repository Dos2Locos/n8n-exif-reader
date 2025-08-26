import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionType, NodeOperationError } from 'n8n-workflow';
import * as ExifParser from 'exif-parser';

/**
 * Format file size in bytes to human readable format
 */
function formatFileSize(bytes: number): string {
	if (bytes === 0) return '0 Bytes';

	const k = 1024;
	const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));

	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export class ExifReader implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'EXIF Reader',
		name: 'exifReader',
		icon: { light: 'file:exif-reader.svg', dark: 'file:exif-reader.svg' },
		group: ['transform'],
		version: 1,
		description: 'Extract EXIF metadata from images (lightweight JSON output only)',
		defaults: {
			name: 'EXIF Reader',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Input Source',
				name: 'inputSource',
				type: 'options',
				options: [
					{
						name: 'Binary Data',
						value: 'binaryData',
						description: 'Read image from binary data property',
					},
					{
						name: 'URL',
						value: 'url',
						description: 'Download image from URL',
					},
				],
				default: 'binaryData',
				description: 'Source of the image to extract EXIF data from',
			},
			{
				displayName: 'Binary Property',
				name: 'binaryProperty',
				type: 'string',
				default: 'data',
				description: 'Name of the binary property that contains the image data',
				displayOptions: {
					show: {
						inputSource: ['binaryData'],
					},
				},
			},
			{
				displayName: 'Image URL',
				name: 'imageUrl',
				type: 'string',
				default: '',
				placeholder: 'https://example.com/image.jpg',
				description: 'URL of the image to download and extract EXIF data from',
				displayOptions: {
					show: {
						inputSource: ['url'],
					},
				},
			},
			{
				displayName: 'Output Property',
				name: 'outputProperty',
				type: 'string',
				default: 'exif',
				description: 'Name of the property to store the extracted EXIF data',
			},
			{
				displayName: 'Include GPS Data',
				name: 'includeGps',
				type: 'boolean',
				default: true,
				description: 'Whether to include GPS coordinates in the output if available',
			},
			{
				displayName: 'Include Image Size',
				name: 'includeImageSize',
				type: 'boolean',
				default: true,
				description: 'Whether to include image dimensions in the output',
			},
			{
				displayName: 'Convert Timestamps',
				name: 'convertTimestamps',
				type: 'boolean',
				default: true,
				description: 'Whether to convert EXIF timestamps to ISO 8601 format',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const inputSource = this.getNodeParameter('inputSource', itemIndex) as string;
				const outputProperty = this.getNodeParameter('outputProperty', itemIndex) as string;
				const includeGps = this.getNodeParameter('includeGps', itemIndex) as boolean;
				const includeImageSize = this.getNodeParameter('includeImageSize', itemIndex) as boolean;
				const convertTimestamps = this.getNodeParameter('convertTimestamps', itemIndex) as boolean;

				let imageBuffer: Buffer;

				if (inputSource === 'binaryData') {
					const binaryProperty = this.getNodeParameter('binaryProperty', itemIndex) as string;
					const binaryData = items[itemIndex].binary?.[binaryProperty];
					
					if (!binaryData) {
						throw new NodeOperationError(
							this.getNode(),
							`No binary data found in property "${binaryProperty}"`,
							{ itemIndex },
						);
					}

					// Convert binary data to buffer
					const binaryDataBuffer = await this.helpers.getBinaryDataBuffer(itemIndex, binaryProperty);
					imageBuffer = binaryDataBuffer;
				} else {
					// Download image from URL
					const imageUrl = this.getNodeParameter('imageUrl', itemIndex) as string;
					
					if (!imageUrl) {
						throw new NodeOperationError(
							this.getNode(),
							'Image URL is required when using URL input source',
							{ itemIndex },
						);
					}

				const response = await this.helpers.httpRequest({
					method: 'GET',
					url: imageUrl,
					returnFullResponse: true,
					encoding: 'arraybuffer',
				});

				// Convert response body to buffer
				imageBuffer = Buffer.from(response.body as ArrayBuffer);
				}

				// Parse EXIF data
				const parser = ExifParser.create(imageBuffer);
				const exifData = parser.parse();

				// Get file information
				let fileName = '';
				const fileSize = imageBuffer.length;

				if (inputSource === 'binaryData') {
					const binaryProperty = this.getNodeParameter('binaryProperty', itemIndex) as string;
					const binaryData = items[itemIndex].binary?.[binaryProperty];
					fileName = binaryData?.fileName || binaryData?.data || 'unknown';
				} else {
					const imageUrl = this.getNodeParameter('imageUrl', itemIndex) as string;
					fileName = imageUrl.split('/').pop() || 'downloaded_image';
				}

				// Process and structure the EXIF data
				const structuredExif: any = {
					fileInfo: {
						fileName: fileName,
						fileSizeBytes: fileSize,
					fileSizeFormatted: formatFileSize(fileSize),
					},
					imageSize: null,
					camera: {},
					lens: {},
					exposure: {},
					gps: null,
					timestamp: null,
					raw: exifData,
				};

				// Image size information
				if (includeImageSize && exifData.imageSize) {
					structuredExif.imageSize = {
						width: exifData.imageSize.width,
						height: exifData.imageSize.height,
					};
				}

				// Camera information
				if (exifData.tags) {
					const tags = exifData.tags;
					
					// Camera details
					if (tags.Make) structuredExif.camera.make = tags.Make;
					if (tags.Model) structuredExif.camera.model = tags.Model;
					if (tags.Software) structuredExif.camera.software = tags.Software;
					
					// Lens information
					if (tags.LensModel) structuredExif.lens.model = tags.LensModel;
					if (tags.LensMake) structuredExif.lens.make = tags.LensMake;
					if (tags.FocalLength) structuredExif.lens.focalLength = `${tags.FocalLength}mm`;
					
					// Exposure settings
					if (tags.ExposureTime) {
						const exposure = tags.ExposureTime;
						structuredExif.exposure.shutterSpeed = exposure < 1 ? `1/${Math.round(1/exposure)}` : `${exposure}s`;
					}
					if (tags.FNumber) structuredExif.exposure.aperture = `f/${tags.FNumber}`;
					if (tags.ISO) structuredExif.exposure.iso = tags.ISO;
					if (tags.ExposureMode !== undefined) {
						const exposureModes = ['Auto', 'Manual', 'Auto bracket'];
						structuredExif.exposure.mode = exposureModes[tags.ExposureMode] || 'Unknown';
					}
					if (tags.Flash !== undefined) {
						structuredExif.exposure.flash = tags.Flash === 1 ? 'Fired' : 'Did not fire';
					}
					
					// GPS information
					if (includeGps && (tags.GPSLatitude || tags.GPSLongitude)) {
						structuredExif.gps = {
							latitude: tags.GPSLatitude || null,
							longitude: tags.GPSLongitude || null,
							altitude: tags.GPSAltitude || null,
							latitudeRef: tags.GPSLatitudeRef || null,
							longitudeRef: tags.GPSLongitudeRef || null,
						};
						
						// Convert coordinates to decimal degrees if reference directions are available
						if (structuredExif.gps.latitude && structuredExif.gps.latitudeRef) {
							structuredExif.gps.latitudeDecimal = structuredExif.gps.latitudeRef === 'S' 
								? -Math.abs(structuredExif.gps.latitude)
								: Math.abs(structuredExif.gps.latitude);
						}
						if (structuredExif.gps.longitude && structuredExif.gps.longitudeRef) {
							structuredExif.gps.longitudeDecimal = structuredExif.gps.longitudeRef === 'W'
								? -Math.abs(structuredExif.gps.longitude)
								: Math.abs(structuredExif.gps.longitude);
						}
					}
					
					// Timestamp information
					if (tags.DateTime || tags.DateTimeOriginal || tags.DateTimeDigitized) {
						const dateTime = tags.DateTimeOriginal || tags.DateTime || tags.DateTimeDigitized;
						if (convertTimestamps && dateTime) {
							// Convert EXIF timestamp to ISO 8601 format
							const timestamp = new Date(dateTime * 1000);
							structuredExif.timestamp = {
								original: dateTime,
								iso: timestamp.toISOString(),
								formatted: timestamp.toLocaleString(),
							};
						} else {
							structuredExif.timestamp = dateTime;
						}
					}
				}

				// Clean up empty objects
				Object.keys(structuredExif).forEach(key => {
					if (typeof structuredExif[key] === 'object' && 
						structuredExif[key] !== null && 
						!Array.isArray(structuredExif[key]) && 
						Object.keys(structuredExif[key]).length === 0) {
						delete structuredExif[key];
					}
				});

				// Add the EXIF data to the output (without binary data)
				const outputData: INodeExecutionData = {
					json: {
						...items[itemIndex].json,
						[outputProperty]: structuredExif,
					},
					// Explicitly exclude binary data to keep output lightweight
				};

				returnData.push(outputData);

			} catch (error) {
				if (this.continueOnFail()) {
					const executionError = error as Error;
					returnData.push({
						json: {
							...items[itemIndex].json,
							error: executionError.message,
						},
						binary: items[itemIndex].binary,
						pairedItem: itemIndex,
					});
				} else {
					if (error.context) {
						error.context.itemIndex = itemIndex;
						throw error;
					}
					throw new NodeOperationError(this.getNode(), error as Error, {
						itemIndex,
					});
				}
			}
		}

		return [returnData];
	}
}
