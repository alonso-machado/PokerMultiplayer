import { useState } from 'react'
import { useSidebarWidth } from '../hooks/useSidebarWidth'

export function PushYourLuckDrawGuide() {
  const [open, setOpen] = useState(false)
  const { style, onDragStart, isDesktop } = useSidebarWidth()

  return (
    <>
      <button type="button"
        className={`hand-guide-toggle${open ? ' active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Regras do Push Your Luck Draw"
        aria-label="Regras do Push Your Luck Draw"
      >
        {open ? '✕' : '?'}
      </button>

      <aside className={`hand-guide-sidebar${open ? ' open' : ''}`} style={style} aria-hidden={!open}>
        {isDesktop && <div className="hg-resize-handle" onMouseDown={onDragStart} title="Arrastar para redimensionar" />}
        <div className="hg-header">
          <h2>Regras do Push Your Luck Draw</h2>
          <span className="hg-sub">2 a 8 jogadores · regra original, sem times</span>
        </div>

        <div className="hg-list tg-list">
          <section className="tg-section">
            <h3>Baralho</h3>
            <p>Baralho próprio: a quantidade de cópias de cada carta é igual ao seu valor — o 2 tem 2 cópias, o 7 tem 7, o Rei tem 13. O Ás de Espadas é único (1 cópia só) e tem um poder especial.</p>
            <p>Coringas não são fixos — a mesa tem <strong>3 Coringas por jogador</strong>. Se alguém entra ou sai durante a partida, 3 Coringas entram ou saem do monte junto (nunca mexendo nas mãos/reservas de quem já está jogando).</p>
            <p>O monte é embaralhado só uma vez, no início da partida — <strong>continua de onde parou</strong> entre rodadas, e só reembaralha o descarte acumulado quando esgota.</p>
          </section>

          <section className="tg-section">
            <h3>Seu turno</h3>
            <p>Na sua vez, escolha <strong>Pedir carta</strong>, <strong>Parar</strong>, ou jogar um Coringa em alguém (ver abaixo). Cada turno resolve só 1 decisão — passa a vez pro próximo jogador em seguida.</p>
            <p>Parar trava sua pontuação da rodada com as cartas que você já tem.</p>
          </section>

          <section className="tg-section">
            <h3>Estouro</h3>
            <p>Se você comprar um valor que já está na sua mão desta rodada, você estoura: perde todas as cartas da rodada e pontua 0 — a menos que você tenha um Coringa guardado.</p>
          </section>

          <section className="tg-section">
            <h3>Coringa: guardar ou jogar</h3>
            <p>Um Coringa não conta como carta de valor — fica guardado na sua reserva. Se você for estourar e tiver ao menos 1 Coringa guardado, ele te salva automaticamente: descarta o Coringa e a carta duplicada, sua mão continua intacta.</p>
            <p><strong>O 1º Coringa que você pegar fica travado</strong> como essa proteção — nunca pode ser jogado em outro jogador. A partir do 2º, você escolhe: guarda como mais uma proteção, ou <strong>joga em outro jogador</strong> (ainda decidindo a rodada) pra colocar uma carta <strong>@</strong> na mão dele. Na hora de pontuar, o @ divide a pontuação da rodada dele por 2 (o Ás dobra primeiro, depois o @ divide). Um jogador só pode levar um @ por rodada.</p>
          </section>

          <section className="tg-section">
            <h3>Ás de Espadas</h3>
            <p>Não vale ponto próprio — se você parar com ele ainda na mão, ele dobra a soma de todas as suas outras cartas daquela rodada.</p>
          </section>

          <section className="tg-section">
            <h3>Pontuação e fim de partida</h3>
            <p>A rodada acaba quando todo mundo parou ou estourou. A partida termina ao final da rodada em que alguém atinge ou ultrapassa a pontuação-alvo — vence quem tiver a maior pontuação total naquele momento (não necessariamente quem bateu o alvo primeiro).</p>
          </section>
        </div>
      </aside>

      {open && <div className="hand-guide-overlay" onClick={() => setOpen(false)} />}
    </>
  )
}
