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
                   file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                   file.type === 'application/msword';

    if (!isPDF && !isWord) {
      return new Response(JSON.stringify({ error: 'Only PDF and Word documents are supported.' }), { status: 400, headers });
    }

    if (file.size > 10 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'File too large. Max 10MB.' }), { status: 400, headers });
    }

    // Convert to base64 for Claude
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    let extractedText = '';

    if (isPDF) {
      // Use Claude's vision to extract text from PDF
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
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: base64
                }
              },
              {
                type: 'text',
                text: 'Extract ALL text from this resume exactly as written. Preserve the structure — keep job titles, companies, dates, bullet points, skills, education. Output the raw text only, no commentary.'
              }
            ]
          }]
        })
      });

      if (!response.ok) throw new Error(`Claude API error: ${response.status}`);
      const data = await response.json();
      extractedText = data.content?.[0]?.text || '';

    } else if (isWord) {
      // For Word docs, use Claude with the raw content
      // Word docs are ZIP files containing XML — Claude can extract meaningful text
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
                source: {
                  type: 'base64',
                  media_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  data: base64
                }
              },
              {
                type: 'text',
                text: 'Extract ALL text from this resume Word document exactly as written. Preserve job titles, companies, dates, bullet points, skills, education. Output the raw text only, no commentary.'
              }
            ]
          }]
        })
      });

      if (!response.ok) throw new Error(`Claude API error: ${response.status}`);
      const data = await response.json();
      extractedText = data.content?.[0]?.text || '';
    }

    if (!extractedText || extractedText.length < 50) {
      return new Response(JSON.stringify({ error: 'Could not extract text from this file. Make sure it contains selectable text (not a scanned image).' }), { status: 422, headers });
    }

    return new Response(JSON.stringify({
      ok: true,
      text: extractedText,
      fileName: file.name,
      fileType: isPDF ? 'pdf' : 'word',
      wordCount: extractedText.split(/\s+/).length
    }), { status: 200, headers });

  } catch(err) {
    console.error('Parse resume error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
