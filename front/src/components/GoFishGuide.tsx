import { useState } from 'react'
import { useSidebarWidth } from '../hooks/useSidebarWidth'

export function GoFishGuide() {
  const [open, setOpen] = useState(false)
  const { style, onDragStart, isDesktop } = useSidebarWidth()

  return (
    <>
      <button type="button"
        className={`hand-guide-toggle${open ? ' active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Regras do Go Fish"
        aria-label="Regras do Go Fish"
      >
        {open ? '✕' : '?'}
      </button>

      <aside className={`hand-guide-sidebar${open ? ' open' : ''}`} style={style} aria-hidden={!open}>
        {isDesktop && <div className="hg-resize-handle" onMouseDown={onDragStart} title="Arrastar para redimensionar" />}
        <div className="hg-header">
          <h2>Regras do Go Fish</h2>
          <span className="hg-sub">2 a 6 jogadores · fonte: bicyclecards.com/how-to-play/go-fish</span>
        </div>

        <div className="hg-list tg-list">
          <section className="tg-section">
            <h3>Baralho e distribuição</h3>
            <p>1 baralho de 52 cartas, sem curinga. 7 cartas por jogador com 2-3 jogadores, 5 cartas com 4 ou mais. O resto forma o monte.</p>
          </section>

          <section className="tg-section">
            <h3>Objetivo</h3>
            <p>Formar o máximo de <strong>baralhos</strong> (4 cartas do mesmo valor). A partida acaba quando os 13 baralhos possíveis são formados — vence quem tiver mais.</p>
          </section>

          <section className="tg-section">
            <h3>Seu turno</h3>
            <p>Escolha um valor que você já tem na mão e peça esse valor a um oponente.</p>
            <p>Se ele tiver, entrega todas as cartas daquele valor — e você pede de novo (pro mesmo ou outro oponente).</p>
            <p>Se não tiver, você "vai pescar": compra 1 carta do monte. Se essa carta for do valor pedido, conta como se tivesse pego — pode pedir de novo. Senão, a vez passa.</p>
          </section>

          <section className="tg-section">
            <h3>Mão vazia</h3>
            <p>Se sua mão fica vazia na sua vez e ainda há monte, você compra 1 carta automaticamente antes de pedir. Sem monte e sem cartas, você fica de fora pelo resto da partida.</p>
          </section>

          <section className="tg-section">
            <h3>Fim de partida</h3>
            <p>Termina ao completar os 13 baralhos, ou antes se sobrar menos de 2 jogadores em condição de jogar. Empate é possível.</p>
          </section>
        </div>
      </aside>

      {open && <div className="hand-guide-overlay" onClick={() => setOpen(false)} />}
    </>
  )
}
