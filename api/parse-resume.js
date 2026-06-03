export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  try {
    // Vercel provides formData via req.body for multipart — use raw approach
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'Multipart form required' });
    }

    // Read raw body as buffer
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks);

    // Extract boundary
    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
    if (!boundaryMatch) return res.status(400).json({ error: 'No boundary in multipart' });
    const boundary = boundaryMatch[1];

    // Parse the multipart body to get the file
    const { fileName, fileBuffer, mimeType } = parseMultipart(rawBody, boundary);
    if (!fileBuffer) return res.status(400).json({ error: 'No file provided' });

    const nameLower = (fileName || '').toLowerCase();
    const isPDF = nameLower.endsWith('.pdf') || mimeType?.includes('pdf');
    const isWord = nameLower.endsWith('.docx') || nameLower.endsWith('.doc') ||
                   mimeType?.includes('word') || mimeType?.includes('officedocument');

    if (!isPDF && !isWord) {
      return res.status(400).json({ error: 'Only PDF and Word documents (.pdf, .doc, .docx) are supported.' });
    }
    if (fileBuffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'File too large. Max 10MB.' });
    }

    let extractedText = '';

    if (isPDF) {
      const base64 = fileBuffer.toString('base64');
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
              { type: 'text', text: 'Extract ALL text from this resume. Preserve structure — job titles, companies, dates, bullets, skills, education. Output raw text only, no commentary.' }
            ]
          }]
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error('PDF extraction failed: ' + response.status + ' ' + errText.slice(0, 100));
      }
      const data = await response.json();
      extractedText = data.content?.[0]?.text || '';

    } else if (isWord) {
      extractedText = extractWordText(fileBuffer);

      // If extraction yielded too little, send to Claude as fallback
      if (!extractedText || extractedText.length < 150) {
        const base64 = fileBuffer.toString('base64');
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 2000,
            messages: [{
              role: 'user',
              content: 'This is a Word document resume in base64. Extract all readable text from it, preserving structure. Only return the extracted text, nothing else.\n\nBase64: ' + base64.slice(0, 4000)
            }]
          })
        });
        if (response.ok) {
          const data = await response.json();
          const result = data.content?.[0]?.text || '';
          if (result && result.length > 100 && result !== 'UNREADABLE') extractedText = result;
        }
      }
    }

    // Validate the extracted text is actually readable
    if (!extractedText || extractedText.length < 50) {
      return res.status(422).json({ error: 'Could not extract readable text. Make sure the file contains selectable text (not a scanned image). Try exporting as PDF.' });
    }

    const readableChars = (extractedText.match(/[A-Za-z][A-Za-z\s]{2,}/g) || []).join('').length;
    if (readableChars / extractedText.length < 0.35) {
      return res.status(422).json({ error: 'Extracted text appears garbled. Try exporting your resume as PDF and uploading that instead.' });
    }

    const wordCount = extractedText.split(/\s+/).filter(w => w.length > 0).length;
    return res.status(200).json({ ok: true, text: extractedText, fileName, fileType: isPDF ? 'pdf' : 'word', wordCount });

  } catch(err) {
    console.error('Parse resume error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

function parseMultipart(buffer, boundary) {
  const boundaryBuf = Buffer.from('--' + boundary);
  const parts = [];
  let start = 0;

  while (start < buffer.length) {
    const boundaryIdx = buffer.indexOf(boundaryBuf, start);
    if (boundaryIdx === -1) break;
    const headerStart = boundaryIdx + boundaryBuf.length + 2; // skip \r\n
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd === -1) break;
    const headers = buffer.slice(headerStart, headerEnd).toString();
    const dataStart = headerEnd + 4;
    const nextBoundary = buffer.indexOf(boundaryBuf, dataStart);
    const dataEnd = nextBoundary === -1 ? buffer.length : nextBoundary - 2; // strip \r\n before boundary
    parts.push({ headers, data: buffer.slice(dataStart, dataEnd) });
    start = nextBoundary === -1 ? buffer.length : nextBoundary;
  }

  for (const part of parts) {
    const cdMatch = part.headers.match(/Content-Disposition:[^\r\n]*/i);
    if (!cdMatch) continue;
    const isFile = /filename=/i.test(cdMatch[0]);
    if (!isFile) continue;
    const fnMatch = cdMatch[0].match(/filename="?([^";\r\n]+)"?/i);
    const fileName = fnMatch ? fnMatch[1].trim() : 'resume';
    const ctMatch = part.headers.match(/Content-Type:\s*([^\r\n]+)/i);
    const mimeType = ctMatch ? ctMatch[1].trim() : '';
    return { fileName, fileBuffer: part.data, mimeType };
  }
  return { fileName: null, fileBuffer: null, mimeType: null };
}

function extractWordText(buffer) {
  try {
    // docx is a ZIP file — find word/document.xml content inside
    const raw = buffer.toString('latin1');

    // Look for XML content with <w:t> tags (standard docx format)
    const xmlMatches = raw.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) || [];
    if (xmlMatches.length > 5) {
      const texts = xmlMatches.map(m => m.replace(/<[^>]+>/g, '').trim()).filter(t => t.length > 0);
      const joined = texts.join(' ').replace(/\s+/g, ' ').trim();
      if (joined.length > 100) return joined;
    }

    // Fallback: extract long runs of readable ASCII
    let readable = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw.charCodeAt(i);
      if ((c >= 32 && c <= 126) || c === 9 || c === 10 || c === 13) {
        readable += raw[i];
      }
    }
    // Filter to sequences that look like words (at least 3 alphabetic chars)
    const words = readable.match(/[A-Za-z]{3,}(?:[A-Za-z0-9 ,.!?:;@()\-/&'"\n\t]*)/g) || [];
    return words.join(' ').replace(/\s+/g, ' ').trim();
  } catch(e) {
    return '';
  }
}
