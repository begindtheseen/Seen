export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }});
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!file) return new Response(JSON.stringify({ error: 'No file provided' }), { status: 400, headers });

    const fileName = file.name?.toLowerCase() || '';
    const isPDF = fileName.endsWith('.pdf') || file.type === 'application/pdf';
    const isWord = fileName.endsWith('.docx') || fileName.endsWith('.doc') ||
                   file.type?.includes('word') || file.type?.includes('officedocument');

    if (!isPDF && !isWord) {
      return new Response(JSON.stringify({ error: 'Only PDF and Word documents (.pdf, .doc, .docx) are supported.' }), { status: 400, headers });
    }

    if (file.size > 10 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'File too large. Max 10MB.' }), { status: 400, headers });
    }

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Convert to base64
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    const base64 = btoa(binary);

    let extractedText = '';

    if (isPDF) {
      // Claude supports PDF natively
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
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: base64 }
              },
              {
                type: 'text',
                text: 'Extract ALL text from this resume. Preserve the structure — job titles, companies, dates, bullet points, skills, education. Output the raw text only, no commentary.'
              }
            ]
          }]
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`PDF extraction failed: ${response.status} ${errText}`);
      }
      const data = await response.json();
      extractedText = data.content?.[0]?.text || '';

    } else if (isWord) {
      // Word docs (.docx) are ZIP files containing XML
      // We'll extract the text from the XML manually
      extractedText = await extractWordText(bytes);

      // If we got meaningful text, great. Otherwise fall back to Claude text extraction
      if (!extractedText || extractedText.length < 100) {
        // Try asking Claude to interpret the raw content
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
              content: `This is raw content extracted from a Word document resume (base64): ${base64.substring(0, 2000)}...
              
Based on any readable text you can find, reconstruct the resume content. If you cannot extract meaningful text, return "UNREADABLE".`
            }]
          })
        });
        const data = await response.json();
        const result = data.content?.[0]?.text || '';
        if (result !== 'UNREADABLE') extractedText = result;
      }
    }

    if (!extractedText || extractedText.length < 50) {
      return new Response(JSON.stringify({ 
        error: 'Could not extract text. Make sure the file contains readable text (not a scanned image). Try saving as PDF and uploading that instead.' 
      }), { status: 422, headers });
    }

    return new Response(JSON.stringify({
      ok: true,
      text: extractedText,
      fileName: file.name,
      fileType: isPDF ? 'pdf' : 'word',
      wordCount: extractedText.split(/\s+/).filter(w => w.length > 0).length
    }), { status: 200, headers });

  } catch(err) {
    console.error('Parse resume error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

// Extract text from .docx (which is a ZIP containing word/document.xml)
async function extractWordText(bytes) {
  try {
    // Look for the XML content between <w:t> tags in the raw bytes
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const raw = decoder.decode(bytes);
    
    // docx files contain XML - extract all text between <w:t> tags
    const matches = raw.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) || [];
    const texts = matches.map(m => m.replace(/<[^>]+>/g, '').trim()).filter(t => t.length > 0);
    
    if (texts.length > 10) {
      return texts.join(' ').replace(/\s+/g, ' ').trim();
    }

    // Also try extracting readable ASCII text directly
    let readable = '';
    for (let i = 0; i < raw.length; i++) {
      const code = raw.charCodeAt(i);
      if ((code >= 32 && code <= 126) || code === 10 || code === 13) {
        readable += raw[i];
      }
    }
    
    // Find sequences of readable text (at least 4 chars)
    const sequences = readable.match(/[A-Za-z][A-Za-z0-9 ,.\-@()&/]{3,}/g) || [];
    return sequences.join(' ').replace(/\s+/g, ' ').trim();
    
  } catch(e) {
    return '';
  }
}
