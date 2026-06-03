export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
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
      const b64 = fileBuffer.toString('base64');
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
              { type: 'text', text: 'Extract ALL text from this resume. Preserve structure — job titles, companies, dates, bullets, skills, education. Output the raw text only, no commentary.' }
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

      if (!extractedText || extractedText.length < 150) {
        const b64 = fileBuffer.toString('base64');
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 4000,
            messages: [{
              role: 'user',
              content: 'Extract all readable text from this Word document resume (base64 encoded). Return only the extracted resume text.\n\nBase64: ' + b64.slice(0, 6000)
            }]
          })
        });
        if (response.ok) {
          const data = await response.json();
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

function extractWordText(buffer) {
  try {
    const raw = buffer.toString('latin1');
    const xmlMatches = raw.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) || [];
    if (xmlMatches.length > 5) {
      const texts = xmlMatches.map(m => m.replace(/<[^>]+>/g, '').trim()).filter(t => t.length > 0);
      const joined = texts.join(' ').replace(/\s+/g, ' ').trim();
      if (joined.length > 100) return joined;
    }
    // Fallback: readable ASCII runs
    let readable = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw.charCodeAt(i);
      if ((c >= 32 && c <= 126) || c === 9 || c === 10 || c === 13) readable += raw[i];
    }
    const words = readable.match(/[A-Za-z]{3,}(?:[A-Za-z0-9 ,.!?:;@()\-/&'"\n\t]*)/g) || [];
    return words.join(' ').replace(/\s+/g, ' ').trim();
  } catch(e) {
    return '';
  }
}
