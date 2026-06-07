import { useState } from 'react'
import { css } from '@firebolt-dev/css'

import { AVATAR_CRUSADER, AVATAR_SARACEN } from '../../core/extras/playerAvatars'

export { AVATAR_CRUSADER, AVATAR_SARACEN }

const MAX_NAME_LENGTH = 24

export function TitleScreen({ onStart }) {
  const [name, setName] = useState('')
  const [side, setSide] = useState('crusader')

  const trimmedName = name.trim()
  const canStart = trimmedName.length > 0

  const handleSubmit = e => {
    e.preventDefault()
    if (!canStart) return
    onStart({
      name: trimmedName.slice(0, MAX_NAME_LENGTH),
      avatar: side === 'saracen' ? AVATAR_SARACEN : AVATAR_CRUSADER,
    })
  }

  return (
    <div
      css={css`
        position: fixed;
        inset: 0;
        background: #0a0a0f;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: auto;
        z-index: 10000;
        .title-panel {
          width: 100%;
          max-width: 22rem;
          padding: 2rem;
          background: rgba(15, 16, 24, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5);
        }
        .title-heading {
          font-size: 2rem;
          font-weight: 600;
          margin: 0 0 0.25rem;
          color: white;
          text-align: center;
        }
        .title-sub {
          color: rgba(255, 255, 255, 0.6);
          font-size: 0.95rem;
          margin: 0 0 1.75rem;
          text-align: center;
        }
        .field-label {
          display: block;
          color: rgba(255, 255, 255, 0.75);
          font-size: 0.85rem;
          font-weight: 500;
          margin-bottom: 0.5rem;
        }
        .name-input {
          width: 100%;
          box-sizing: border-box;
          padding: 0.65rem 0.85rem;
          background: rgba(0, 0, 0, 0.35);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 8px;
          color: white;
          font-size: 1rem;
          margin-bottom: 1.25rem;
          outline: none;
          &:focus {
            border-color: rgba(255, 255, 255, 0.35);
          }
        }
        .side-row {
          display: flex;
          gap: 0.75rem;
          margin-bottom: 1.75rem;
        }
        .side-btn {
          flex: 1;
          padding: 0.75rem 1rem;
          background: rgba(0, 0, 0, 0.35);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          color: rgba(255, 255, 255, 0.85);
          font-size: 1rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          &:hover {
            border-color: rgba(255, 255, 255, 0.25);
          }
          &.selected {
            background: rgba(255, 255, 255, 0.12);
            border-color: rgba(255, 255, 255, 0.45);
            color: white;
          }
        }
        .enter-btn {
          width: 100%;
          padding: 0.85rem 1rem;
          background: rgba(255, 255, 255, 0.95);
          border: none;
          border-radius: 8px;
          color: #0a0a0f;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.2s;
          &:disabled {
            opacity: 0.35;
            cursor: not-allowed;
          }
          &:not(:disabled):hover {
            background: white;
          }
        }
      `}
    >
      <form className='title-panel' onSubmit={handleSubmit}>
        <h1 className='title-heading'>Hyperfy</h1>
        <p className='title-sub'>Choose your name and allegiance</p>

        <label className='field-label' htmlFor='username'>
          Username
        </label>
        <input
          id='username'
          className='name-input'
          type='text'
          value={name}
          maxLength={MAX_NAME_LENGTH}
          placeholder='Enter your name'
          autoComplete='off'
          autoFocus
          onChange={e => setName(e.target.value)}
        />

        <span className='field-label'>Side</span>
        <div className='side-row'>
          <button
            type='button'
            className={`side-btn${side === 'crusader' ? ' selected' : ''}`}
            onClick={() => setSide('crusader')}
          >
            Crusader
          </button>
          <button
            type='button'
            className={`side-btn${side === 'saracen' ? ' selected' : ''}`}
            onClick={() => setSide('saracen')}
          >
            Saracen
          </button>
        </div>

        <button type='submit' className='enter-btn' disabled={!canStart}>
          Enter game
        </button>
      </form>
    </div>
  )
}
