// functions/emailFormatting.js: Provides safe, client-compatible HTML email building blocks.

const escapeHtml = (value) => String( value ?? "" )
  .replace( /&/g, "&amp;" )
  .replace( /</g, "&lt;" )
  .replace( />/g, "&gt;" )
  .replace( /"/g, "&quot;" )
  .replace( /'/g, "&#39;" )

const renderHtmlText = (value) => escapeHtml( value ).replace( /\r?\n/g, "<br>" )

const normalizeEmailUrl = (value) => {
  try {
    const url = new URL( String( value ?? "" ) )
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : ""
  } catch {
    return ""
  }
}

const buildEmailLink = (urlValue, label) => {
  const url = normalizeEmailUrl( urlValue )
  if( !url ) {
    return ""
  }
  return `<a href="${escapeHtml( url )}" style="color:#0b57d0;font-weight:600;">${escapeHtml( label )}</a>`
}

const buildEmailDocument = ({ body, preheader, title }) => [
  "<!doctype html>",
  '<html lang="en">',
  "<head>",
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  `<title>${escapeHtml( title )}</title>`,
  "</head>",
  '<body style="margin:0;background:#f4f7fb;color:#172033;font-family:Arial,sans-serif;line-height:1.5;">',
  '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">',
  escapeHtml( preheader ),
  "</div>",
  '<main style="max-width:720px;margin:0 auto;padding:28px 16px;">',
  '<div style="background:#ffffff;border:1px solid #dbe3ef;border-radius:12px;padding:28px;">',
  body,
  "</div>",
  '<p style="margin:18px 0 0;color:#64748b;font-size:12px;text-align:center;">QT4</p>',
  "</main>",
  "</body>",
  "</html>",
].join( "" )

module.exports = {
  buildEmailDocument,
  buildEmailLink,
  escapeHtml,
  renderHtmlText,
}
