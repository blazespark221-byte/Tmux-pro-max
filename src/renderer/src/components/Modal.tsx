import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { actions, useApp } from '../store/app'
import { CloseIcon } from './Icons'

export function Modal({
  title,
  subtitle,
  children,
  footer,
  width = 640,
  onClose
}: {
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
  onClose?: () => void
}) {
  const close = onClose ?? (() => actions.setModal(null))
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="modal-card" style={{ width }} ref={cardRef} role="dialog" aria-modal="true">
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="modal-subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={close} title="Close (Esc)">
            <CloseIcon />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmModal() {
  const modal = useApp((s) => s.modal)
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    confirmRef.current?.focus()
  }, [modal])
  if (modal?.type !== 'confirm') return null
  return (
    <Modal
      title={modal.title}
      width={440}
      onClose={() => modal.resolve(false)}
      footer={
        <>
          <button type="button" className="btn" onClick={() => modal.resolve(false)}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`btn ${modal.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => modal.resolve(true)}
          >
            {modal.confirmLabel}
          </button>
        </>
      }
    >
      <p className="confirm-message">{modal.message}</p>
    </Modal>
  )
}
