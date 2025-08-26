declare module 'exif-parser' {
  interface ExifData {
    imageSize?: {
      width: number;
      height: number;
    };
    tags?: {
      [key: string]: any;
      Make?: string;
      Model?: string;
      Software?: string;
      LensModel?: string;
      LensMake?: string;
      FocalLength?: number;
      ExposureTime?: number;
      FNumber?: number;
      ISO?: number;
      ExposureMode?: number;
      Flash?: number;
      GPSLatitude?: number;
      GPSLongitude?: number;
      GPSAltitude?: number;
      GPSLatitudeRef?: string;
      GPSLongitudeRef?: string;
      DateTime?: number;
      DateTimeOriginal?: number;
      DateTimeDigitized?: number;
    };
  }

  interface ExifParser {
    parse(): ExifData;
  }

  function create(buffer: Buffer): ExifParser;
  
  export { create, ExifData, ExifParser };
}
