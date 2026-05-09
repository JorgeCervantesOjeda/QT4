// src/components/AboutDialog.tsx: Shows app identity, support links, and concise product metadata in a modal dialog.
import { APP_METADATA } from '../lib/appMetadata'
import ModalDialog from './ModalDialog'

type AboutDialogProps = {
  onClose: () => void
}

function AboutDialog( { onClose }: AboutDialogProps ) {
  return (
    <ModalDialog onClose={onClose}>
      <section className="about-card" aria-label="About QualiTeam">
        <p className="app-eyebrow">About this app</p>
        <h3>{APP_METADATA.productName}</h3>
        <p className="about-card__intro">
          {APP_METADATA.description}
        </p>
        <div className="about-card__section">
          <p className="about-card__label">Institution</p>
          <p>{APP_METADATA.institutionName}</p>
        </div>
        <div className="about-card__section">
          <p className="about-card__label">Support</p>
          <div className="about-card__links">
            <a href={APP_METADATA.helpAssistantUrl} target="_blank" rel="noreferrer">
              {APP_METADATA.supportLabel}
            </a>
            <a href={APP_METADATA.institutionSiteUrl} target="_blank" rel="noreferrer">
              {APP_METADATA.institutionSiteLabel}
            </a>
          </div>
        </div>
        <dl className="about-card__meta">
          <div>
            <dt>Version</dt>
            <dd>{APP_METADATA.appVersion}</dd>
          </div>
          <div>
            <dt>Technology</dt>
            <dd>{APP_METADATA.technologyLabel}</dd>
          </div>
        </dl>
      </section>
      <div className="actions actions--inline">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </ModalDialog>
  )
}

export default AboutDialog
