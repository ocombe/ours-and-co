import { useState, type FormEvent } from 'react'
import { supabase } from './supabase'

const appUrl = () => window.location.origin + import.meta.env.BASE_URL

export function Login() {
  const [email, setEmail] = useState('')
  const [showEmail, setShowEmail] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')

  async function google() {
    setError('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: appUrl() },
    })
    if (error) {
      setError(error.message)
      setState('error')
    }
  }

  async function sendLink(e: FormEvent) {
    e.preventDefault()
    setState('sending')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: appUrl() },
    })
    if (error) {
      setError(error.message)
      setState('error')
    } else {
      setState('sent')
    }
  }

  return (
    <main className="center-card">
      <img
        className="login-bear"
        src={import.meta.env.BASE_URL + 'icons/icon-512.png'}
        alt="Un ours grognon en pull bleu"
        width="168"
        height="168"
      />
      <h1 className="brand big">Ours &amp; Co</h1>
      <p className="lede">Les repas, les courses et la réserve de la famille.</p>

      {state === 'sent' ? (
        <p>
          Un lien de connexion est parti à <strong>{email}</strong>. Ouvre-le sur cet appareil pour
          entrer.
        </p>
      ) : (
        <div className="stack">
          <button className="btn honey" onClick={google}>
            Se connecter avec Google
          </button>

          {showEmail ? (
            <form onSubmit={sendLink} className="stack">
              <label className="field">
                <span>Ton e-mail</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <button className="btn ghost" disabled={state === 'sending'}>
                {state === 'sending' ? 'Envoi…' : 'Recevoir un lien par e-mail'}
              </button>
            </form>
          ) : (
            <button className="btn ghost" onClick={() => setShowEmail(true)}>
              Recevoir un lien par e-mail
            </button>
          )}

          {state === 'error' && <p className="error">La connexion a échoué : {error}</p>}
        </div>
      )}
    </main>
  )
}
