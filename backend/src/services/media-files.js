const formats = [
  {
    mime: 'image/jpeg',
    extension: 'jpg',
    category: 'image',
    maxBytes: 8 * 1024 * 1024,
    matches: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  },
  {
    mime: 'image/png',
    extension: 'png',
    category: 'image',
    maxBytes: 8 * 1024 * 1024,
    matches: (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/webp',
    extension: 'webp',
    category: 'image',
    maxBytes: 8 * 1024 * 1024,
    matches: (buffer) => buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP',
  },
  {
    mime: 'video/mp4',
    extension: 'mp4',
    category: 'video',
    maxBytes: 100 * 1024 * 1024,
    matches: (buffer) => buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp',
  },
  {
    mime: 'video/webm',
    extension: 'webm',
    category: 'video',
    maxBytes: 100 * 1024 * 1024,
    matches: (buffer) => buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
  },
  {
    mime: 'application/pdf',
    extension: 'pdf',
    category: 'document',
    maxBytes: 20 * 1024 * 1024,
    matches: (buffer) => buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-',
  },
  {
    mime: 'text/plain',
    extension: 'txt',
    category: 'document',
    maxBytes: 20 * 1024 * 1024,
    matches: (buffer) => {
      if (!buffer.length || buffer.includes(0)) return false;
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        return true;
      } catch {
        return false;
      }
    },
  },
];

function identifyMediaFile(buffer, mimeType) {
  return formats.find((format) => format.mime === mimeType && format.matches(buffer));
}

module.exports = { identifyMediaFile };
