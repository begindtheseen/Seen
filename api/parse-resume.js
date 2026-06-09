import zlib from 'zlib';
import { promisify } from 'util';
const inflateRaw = promisify(zlib.inflateRaw);

export default async function handler(req, res) {
  const _o=req.headers.origin||'';
  const _devO=!_o||_o.includes('localhost')||_o.includes('127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin',(_devO||['https://seenjobs.io','https://www.seenjobs.io'].includes(_o))?(_o||'*'):'https://seenjobs.io');
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }
    if (!body || typeof body !== 'object') body = {};

    const { base64, fileName, mimeType } = body;
    if (!base64) return res.status(400).json({ error: 'No file data provided' });

    const fileBuffer = Buffer.from(base64, 'base64');
    if (fileBuffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'File too large. Max 10MB.' });
    }

    const nameLower = (fileName || '').toLowerCase();
    const isPDF = nameLower.endsWith('.pdf') || (mimeType || '').includes('pdf');
    const isWord = nameLower.endsWith('.docx') || nameLower.endsWith('.doc') ||
                   (mimeType || '').includes('word') || (mimeType || '').includes('officedocument');

    if (!isPDF && !isWord) {
      return res.status(400).json({ error: 'Only PDF and Word documents (.pdf, .doc, .docx) are supported.' });
    }

    let extractedText = '';

    if (isPDF) {
      // Use Claude's native PDF vision — retry on rate limit
      const b64 = fileBuffer.toString('base64');
      let apiRes;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          const wait = apiRes?.headers?.get('retry-after');
          await new Promise(r => setTimeout(r, wait ? Math.min(parseInt(wait) * 1000, 20000) : attempt * 6000));
        }
        apiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'pdfs-2024-09-25',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 3000,
            messages: [{
              role: 'user',
              content: [
                { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
                { type: 'text', text: 'Extract ALL text from this resume. Preserve structure — job titles, companies, dates, bullets, skills, education. Output the raw text only, no commentary.' }
              ]
            }]
          })
        });
        if (apiRes.status !== 429) break;
      }

      if (!apiRes.ok) {
        const errText = await apiRes.text();
        throw new Error('PDF extraction failed: ' + apiRes.status + ' ' + errText.slice(0, 100));
      }
      const data = await apiRes.json();
      extractedText = data.content?.[0]?.text || '';

    } else if (isWord) {
      // Proper DOCX extraction: parse the ZIP, decompress word/document.xml, pull <w:t> content
      extractedText = await extractDocxText(fileBuffer);

      // If ZIP parsing failed (old .doc binary, corrupted file), fall back to Claude
      if (!extractedText || extractedText.length < 150) {
        const b64 = fileBuffer.toString('base64');
        let apiRes;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt > 0) {
            const wait = apiRes?.headers?.get('retry-after');
            await new Promise(r => setTimeout(r, wait ? Math.min(parseInt(wait) * 1000, 20000) : attempt * 6000));
          }
          apiRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': process.env.ANTHROPIC_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 3000,
              messages: [{
                role: 'user',
                content: 'Extract all text from this Word document resume (base64). Return ONLY the extracted resume text with no commentary.\n\nBase64: ' + b64.slice(0, 8000)
              }]
            })
          });
          if (apiRes.status !== 429) break;
        }
        if (apiRes?.ok) {
          const data = await apiRes.json();
          const result = data.content?.[0]?.text || '';
          if (result && result.length > 100) extractedText = result;
        }
      }
    }

    if (!extractedText || extractedText.length < 50) {
      return res.status(422).json({ error: 'Could not extract readable text. Make sure the file has selectable text (not a scanned image). Try exporting as PDF.' });
    }

    const wordCount = extractedText.split(/\s+/).filter(w => w.length > 0).length;
    return res.status(200).json({ ok: true, text: extractedText, fileName, fileType: isPDF ? 'pdf' : 'word', wordCount });

  } catch(err) {
    console.error('Parse resume error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// Parse DOCX (ZIP archive) using Node.js built-in zlib — no npm required.
// Finds word/document.xml, decompresses it (DEFLATE), extracts <w:t> text runs.
async function extractDocxText(buffer) {
  try {
    const xml = await readZipEntry(buffer, 'word/document.xml');
    if (!xml) return '';

    // Decode XML entities and extract text runs
    const xmlMatches = xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
    const texts = xmlMatches
      .map(m => m.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"').trim())
      .filter(t => t.length > 0);

    // Preserve paragraph breaks by detecting paragraph boundaries
    let result = '';
    let inParagraph = false;
    const paragraphs = xml.split(/<\/w:p>/);
    for (const para of paragraphs) {
      const tMatches = para.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
      const paraText = tMatches
        .map(m => m.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"'))
        .join('').trim();
      if (paraText) result += paraText + '\n';
    }

    return result.trim() || texts.join(' ');
  } catch(e) {
    return '';
  }
}

// Minimal ZIP reader — finds a named entry, decompresses if needed
async function readZipEntry(buffer, targetName) {
  let offset = 0;

  while (offset < buffer.length - 30) {
    // Local file header signature: PK\x03\x04
    if (buffer[offset] !== 0x50 || buffer[offset+1] !== 0x4B ||
        buffer[offset+2] !== 0x03 || buffer[offset+3] !== 0x04) {
      offset++;
      continue;
    }

    const compression   = buffer.readUInt16LE(offset + 8);
    const compressedSz  = buffer.readUInt32LE(offset + 18);
    const uncompressedSz = buffer.readUInt32LE(offset + 22);
    const nameLen       = buffer.readUInt16LE(offset + 26);
    const extraLen      = buffer.readUInt16LE(offset + 28);

    const entryName = buffer.slice(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;

    if (entryName === targetName) {
      const compressed = buffer.slice(dataStart, dataStart + compressedSz);
      if (compression === 0) {
        // Stored (no compression)
        return compressed.toString('utf8');
      } else if (compression === 8) {
        // DEFLATE
        const decompressed = await inflateRaw(compressed);
        return decompressed.toString('utf8');
      }
      return null; // unsupported compression
    }

    offset = dataStart + compressedSz;
    if (compressedSz === 0 && nameLen === 0) offset++; // guard against infinite loop
  }

  return null; // entry not found
}
