// functions/hourlyNotificationDigestHtml.js: Renders hourly digest content as safe HTML.
const {
  buildEmailDocument,
  buildEmailLink,
  escapeHtml,
  renderHtmlText,
} = require( "./emailFormatting" )

const buildHourlyNotificationDigestHtml = ({ hourKey, normalizedEvents, projects }) => {
  const projectHtml = projects.map( (project) => `
    <section style="margin:24px 0 0;">
      <h2 style="margin:0 0 14px;color:#0b57d0;font-size:20px;">${escapeHtml( project.label )}</h2>
      ${project.documents.map( (document) => `
        <div style="margin:0 0 18px;padding-left:14px;border-left:3px solid #dbe3ef;">
          <h3 style="margin:0 0 12px;font-size:17px;">${escapeHtml( document.label )}</h3>
          ${document.versions.map( (version) => `
            <div style="margin:0 0 14px;">
              <h4 style="margin:0 0 8px;font-size:15px;">${escapeHtml( version.label )}</h4>
              ${version.issues.map( (issue) => `
                <article style="margin:0 0 14px;padding:14px;background:#f4f7fb;border-radius:8px;">
                  <h5 style="margin:0 0 8px;font-size:15px;">${escapeHtml( issue.title )}</h5>
                  ${issue.issueUrl ? `<p style="margin:0 0 12px;">${buildEmailLink( issue.issueUrl, "Open issue" )}</p>` : ""}
                  <p style="margin:0 0 8px;font-weight:600;">Comments</p>
                  <ul style="margin:0;padding-left:22px;">
                    ${issue.comments.map( (comment) => `<li style="margin:0 0 8px;"><strong>${escapeHtml( comment.actorLabel )}:</strong> ${renderHtmlText( comment.commentText || comment.commentExcerpt || "(no comment text)" )}</li>` ).join( "" )}
                  </ul>
                </article>
              `).join( "" )}
            </div>
          `).join( "" )}
        </div>
      `).join( "" )}
    </section>
  `).join( "" )
  return buildEmailDocument( {
    body: [
      '<h1 style="margin:0 0 8px;color:#172033;font-size:26px;">QT4 hourly activity summary</h1>',
      `<p style="margin:0;color:#64748b;">Hour: ${escapeHtml( hourKey )} · Related items: ${normalizedEvents.length}</p>`,
      projectHtml,
    ].join( "" ),
    preheader: `${normalizedEvents.length} related items for ${hourKey}.`,
    title: "QT4 — Hourly activity summary",
  } )
}

module.exports = {
  buildHourlyNotificationDigestHtml,
}
