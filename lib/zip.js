import archiver from 'archiver';

export function zipNamedBuffers(namedBuffers) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks = [];
    archive.on('data', d => chunks.push(d));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    for (const [name, buf] of Object.entries(namedBuffers)) {
      archive.append(buf, { name });
    }
    archive.finalize();
  });
}
