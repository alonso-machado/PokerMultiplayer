import { useState } from 'react'
import { PlayingCard } from './PlayingCard'
import { useSidebarWidth } from '../hooks/useSidebarWidth'
import type { Card } from '../../../shared/types'

// Strongest → weakest: 4♣ (Zap) > 7♥ (Copas) > A♠ (Espadilha) > 7♦ (Ouros) —
// same suit order/naming as the vira variant, see Manilha sections below.
const FIXED_MANILHAS: (Card & { label: string })[] = [
  { suit: 'clubs', rank: '4', label: 'Zap' },
  { suit: 'hearts', rank: '7', label: 'Copas' },
  { suit: 'spades', rank: 'A', label: 'Espadilha' },
  { suit: 'diamonds', rank: '7', label: 'Ouros' },
]

export function TrucoGuide() {
  const [open, setOpen] = useState(false)
  const { style, onDragStart, isDesktop } = useSidebarWidth()

  return (
    <>
      <button
        className={`hand-guide-toggle${open ? ' active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Regras do Truco"
        aria-label="Regras do Truco"
      >
        {open ? '✕' : '?'}
      </button>

      <aside className={`hand-guide-sidebar${open ? ' open' : ''}`} style={style} aria-hidden={!open}>
        {isDesktop && <div className="hg-resize-handle" onMouseDown={onDragStart} title="Arrastar para redimensionar" />}
        <div className="hg-header">
          <h2>Regras do Truco</h2>
          <span className="hg-sub">Truco Paulista (vira) e Mineiro (fixa)</span>
        </div>

        <div className="hg-list tg-list">
          <section className="tg-section">
            <h3>Baralho</h3>
            <p>40 cartas — sem 8, 9, 10, sem curingas.</p>
            <p>Ranking base (fraca → forte): 4, 5, 6, 7, Q, J, K, A, 2, 3.</p>
          </section>

          <section className="tg-section">
            <h3>Manilha: Vira (Paulista)</h3>
            <p>Uma carta é virada a cada mão. A manilha é o próximo valor da sequência, em todos os naipes.</p>
            <p className="hint">Ordem de força dos naipes:</p>
            <div className="tg-order">
              <span>Paus (Zap)</span><span>&gt;</span><span>Copas</span><span>&gt;</span>
              <span>Espadas</span><span>&gt;</span><span>Ouros</span>
            </div>
          </section>

          <section className="tg-section">
            <h3>Manilha: Fixa (Mineiro)</h3>
            <p>Sem vira — as manilhas são sempre as mesmas, a partida toda (mesma ordem de naipe acima):</p>
            <div className="tg-cards-row">
              {FIXED_MANILHAS.map((c, i) => (
                <div key={i} className="tg-card-label">
                  <PlayingCard card={c} width={32} />
                  <span className="hint">{c.label}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="tg-section">
            <h3>Vazas</h3>
            <p>Cada mão tem até 3 vazas (1 carta por jogador). Vence quem fizer 2 vazas.</p>
            <p>Empates: se a 1ª vaza empata, quem ganha a 2ª leva a mão. Se a 2ª empata após a 1ª ter vencedor, o vencedor da 1ª leva a mão. Se as duas primeiras empatam, decide a 3ª — e se essa também empatar, ninguém pontua.</p>
          </section>

          <section className="tg-section">
            <h3>Pedir Truco</h3>
            <table className="tg-table">
              <tbody>
                <tr><td>Sem pedido</td><td>1 ponto</td></tr>
                <tr><td>Truco</td><td>3 pontos</td></tr>
                <tr><td>Seis</td><td>6 pontos</td></tr>
                <tr><td>Nove</td><td>9 pontos</td></tr>
                <tr><td>Doze</td><td>12 pontos (teto)</td></tr>
              </tbody>
            </table>
            <p>Quem recusa um pedido cede ao adversário os pontos do último valor já aceito.</p>
          </section>

          <section className="tg-section">
            <h3>Mão de 11 e Mão de Ferro</h3>
            <p>Ao chegar a 11 pontos, antes da mão seguinte a dupla vê as cartas do parceiro e decide jogar ou correr (cede 1 ponto). Se as duas duplas estiverem em 11, é "mão de ferro" — ambas veem as cartas.</p>
          </section>

          <section className="tg-section">
            <h3>Partida</h3>
            <p>Vence a partida quem chegar primeiro a 12 pontos. A mesa continua aberta — todos votam se querem revanche.</p>
          </section>
        </div>
      </aside>

      {open && <div className="hand-guide-overlay" onClick={() => setOpen(false)} />}
    </>
  )
}
