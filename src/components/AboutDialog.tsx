// src/components/AboutDialog.tsx: Shows app identity, support links, and technical metadata in a modal dialog.
import { APP_METADATA } from '../lib/appMetadata'
import ModalDialog from './ModalDialog'

type AboutDialogProps = {
  onClose: () => void
}

function AboutDialog( { onClose }: AboutDialogProps ) {
  const buildLabel = import.meta.env.VITE_APP_BUILD?.trim() || 'Not set'

  return (
    <ModalDialog onClose={onClose}>
      <section className="about-card" aria-label="About QualiTeam">
        <p className="app-eyebrow">About this app</p>
        <h3>
          {APP_METADATA.productName} <span className="brand-version">{APP_METADATA.marketingVersion}</span>
        </h3>
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
            <dt>Product version</dt>
            <dd>{APP_METADATA.marketingVersion}</dd>
          </div>
          <div>
            <dt>Technical version</dt>
            <dd>{APP_METADATA.technicalVersion}</dd>
          </div>
          <div>
            <dt>Build</dt>
            <dd>{buildLabel}</dd>
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
