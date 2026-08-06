import { useState } from 'react'
import { PlayingCard } from './PlayingCard'
import { useSidebarWidth } from '../hooks/useSidebarWidth'
import type { Card } from '../../../shared/types'

// Strongest → weakest: A♠ (Espadilha) > A♣ (Basto) > 7♠ > 7♦ — see .claude/TrucoGaucho.md.
const MANILHAS: (Card & { label: string })[] = [
  { suit: 'spades', rank: 'A', label: 'Espadilha' },
  { suit: 'clubs', rank: 'A', label: 'Basto' },
  { suit: 'spades', rank: '7', label: '7 de Espadas' },
  { suit: 'diamonds', rank: '7', label: '7 de Ouros' },
]

export function GauchoGuide() {
  const [open, setOpen] = useState(false)
  const { style, onDragStart, isDesktop } = useSidebarWidth()

  return (
    <>
      <button
        className={`hand-guide-toggle${open ? ' active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Regras do Truco Gaúcho"
        aria-label="Regras do Truco Gaúcho"
      >
        {open ? '✕' : '?'}
      </button>

      <aside className={`hand-guide-sidebar${open ? ' open' : ''}`} style={style} aria-hidden={!open}>
        {isDesktop && <div className="hg-resize-handle" onMouseDown={onDragStart} title="Arrastar para redimensionar" />}
        <div className="hg-header">
          <h2>Regras do Truco Gaúcho</h2>
          <span className="hg-sub">Truco Gaúcho / Espanhol — jogo separado do Truco Paulista/Mineiro</span>
        </div>

        <div className="hg-list tg-list">
          <section className="tg-section">
            <h3>Baralho e Vazas</h3>
            <p>40 cartas, sem 8/9/10, sem curingas. Ranking base (fraca → forte): 4, 5, 6, 7, J, Q, K, A, 2, 3 — repare que aqui o J é mais fraco que o Q (o oposto do Truco Paulista).</p>
            <p>Cada mão tem até 3 vazas; vence quem fizer 2. Mesma cascata de empate do Truco comum.</p>
          </section>

          <section className="tg-section">
            <h3>Manilhas — sempre fixas</h3>
            <p>Sem carta vira. São sempre estas 4 cartas específicas, a partida toda:</p>
            <div className="tg-cards-row">
              {MANILHAS.map((c, i) => (
                <div key={i} className="tg-card-label">
                  <PlayingCard card={c} width={32} />
                  <span className="hint">{c.label}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="tg-section">
            <h3>Pedir Truco</h3>
            <table className="tg-table">
              <tbody>
                <tr><td>Sem pedido</td><td>1 ponto</td></tr>
                <tr><td>Truco</td><td>2 pontos</td></tr>
                <tr><td>Retruco</td><td>3 pontos</td></tr>
                <tr><td>Vale Quatro</td><td>4 pontos (teto)</td></tr>
              </tbody>
            </table>
            <p>Quem recusa cede ao adversário os pontos do último valor já aceito.</p>
          </section>

          <section className="tg-section">
            <h3>Envido</h3>
            <p>Só na 1ª vaza, antes dela resolver. Valor: melhor par do mesmo naipe (soma + 20), ou a carta mais alta isolada se não houver par. Ás=1, 2-7=número, J/Q/K=0.</p>
            <table className="tg-table">
              <tbody>
                <tr><td>Envido</td><td>2 pontos</td></tr>
                <tr><td>Real Envido</td><td>5 pontos</td></tr>
                <tr><td>Falta Envido</td><td>o que falta pro time na frente chegar a 12</td></tr>
              </tbody>
            </table>
            <p>Aceitar já compara e pontua na hora. Empate vence quem está com a mão. Chamar truco fecha o envido da mão.</p>
          </section>

          <section className="tg-section">
            <h3>Flor</h3>
            <p>Automática: 3 cartas do mesmo naipe. Se alguém tem flor, o envido fica fechado na mão inteira. Valor: soma das 3 cartas + 20.</p>
            <table className="tg-table">
              <tbody>
                <tr><td>Flor</td><td>3 pontos</td></tr>
                <tr><td>Contra-Flor</td><td>6 pontos</td></tr>
                <tr><td>Contra-Flor e o Resto</td><td>o que falta pro time na frente chegar a 12</td></tr>
              </tbody>
            </table>
            <p>Se só um time tem flor, pontua sozinha, sem resposta. Se os dois times têm, funciona como o Envido.</p>
          </section>

          <section className="tg-section">
            <h3>Mão de 11, Partida e Revanche</h3>
            <p>Mesma regra do Truco comum: ao chegar a 11, a dupla vê as cartas do parceiro e decide jogar ou correr. Vence a partida quem chegar a 12 pontos primeiro; a mesa continua aberta para revanche.</p>
          </section>
        </div>
      </aside>

      {open && <div className="hand-guide-overlay" onClick={() => setOpen(false)} />}
    </>
  )
}
