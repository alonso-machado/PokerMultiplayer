import { useState } from 'react'
import { useSidebarWidth } from '../hooks/useSidebarWidth'

export function BlackjackGuide() {
  const [open, setOpen] = useState(false)
  const { style, onDragStart, isDesktop } = useSidebarWidth()

  return (
    <>
      <button type="button"
        className={`hand-guide-toggle${open ? ' active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Regras do Blackjack / 21"
        aria-label="Regras do Blackjack / 21"
      >
        {open ? '✕' : '?'}
      </button>

      <aside className={`hand-guide-sidebar${open ? ' open' : ''}`} style={style} aria-hidden={!open}>
        {isDesktop && <div className="hg-resize-handle" onMouseDown={onDragStart} title="Arrastar para redimensionar" />}
        <div className="hg-header">
          <h2>Regras do Blackjack / 21</h2>
          <span className="hg-sub">Fonte única: bicyclecards.com/how-to-play/blackjack</span>
        </div>

        <div className="hg-list tg-list">
          <section className="tg-section">
            <h3>Mesa</h3>
            <p>Sem sala pra escolher — você entra numa mesa aberta (até 7 jogadores por dealer) ou o servidor cria uma nova.</p>
            <p>Começa com 100 fichas. Aposte quanto quiser a cada rodada (1 até o total das suas fichas). Não existe recarga: o que vai pro dealer não volta, e ao zerar as fichas você sai da mesa.</p>
          </section>

          <section className="tg-section">
            <h3>Baralho e valores</h3>
            <p>1 baralho de 52 cartas, sem curinga, embaralhado de novo a cada rodada.</p>
            <p>Figuras (J, Q, K) valem 10. Ás vale 11 ou 1 — o que não estourar a mão. Demais cartas valem o número de pontos.</p>
          </section>

          <section className="tg-section">
            <h3>Sua vez</h3>
            <p><strong>Pedir:</strong> compra mais uma carta.</p>
            <p><strong>Parar:</strong> encerra sua mão com o total atual.</p>
            <p><strong>Dobrar:</strong> só na primeira decisão (2 cartas) — dobra a aposta, recebe exatamente mais 1 carta e para automaticamente.</p>
            <p><strong>Dividir:</strong> só com um par na mão inicial — separa em duas mãos, cada uma com aposta igual à original. Sem redivisão. Ás dividido recebe 1 carta e para automaticamente; 21 depois de dividir não paga como Blackjack.</p>
          </section>

          <section className="tg-section">
            <h3>Dealer</h3>
            <p>Revela a carta escondida e compra até somar 17 ou mais — para em qualquer 17 (inclusive "soft").</p>
            <p>Se a carta virada do dealer for Ás ou valer 10, ele espia a escondida: com Blackjack, revela na hora e todas as mãos são resolvidas sem ninguém jogar.</p>
          </section>

          <section className="tg-section">
            <h3>Seguro</h3>
            <p>Só quando a carta virada do dealer é um Ás. Aposta extra de até metade da sua aposta principal.</p>
            <p>Paga 2:1 se o dealer tiver Blackjack; se não tiver, o seguro é perdido e o jogo segue normalmente.</p>
          </section>

          <section className="tg-section">
            <h3>Pagamentos</h3>
            <table className="tg-table">
              <tbody>
                <tr><td>Blackjack (Ás + carta de 10, 2 cartas)</td><td>paga 3:2</td></tr>
                <tr><td>Vitória normal</td><td>paga 1:1</td></tr>
                <tr><td>Empate (push)</td><td>aposta de volta</td></tr>
                <tr><td>Estourou / perdeu</td><td>perde a aposta</td></tr>
              </tbody>
            </table>
          </section>
        </div>
      </aside>

      {open && <div className="hand-guide-overlay" onClick={() => setOpen(false)} />}
    </>
  )
}
