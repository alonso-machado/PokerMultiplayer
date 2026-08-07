import { useState } from 'react'
import { useSidebarWidth } from '../hooks/useSidebarWidth'

export function CanastraGuide() {
  const [open, setOpen] = useState(false)
  const { style, onDragStart, isDesktop } = useSidebarWidth()

  return (
    <>
      <button type="button"
        className={`hand-guide-toggle${open ? ' active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Regras da Canastra / Buraco"
        aria-label="Regras da Canastra / Buraco"
      >
        {open ? '✕' : '?'}
      </button>

      <aside className={`hand-guide-sidebar${open ? ' open' : ''}`} style={style} aria-hidden={!open}>
        {isDesktop && <div className="hg-resize-handle" onMouseDown={onDragStart} title="Arrastar para redimensionar" />}
        <div className="hg-header">
          <h2>Regras da Canastra / Buraco</h2>
          <span className="hg-sub">1x1 (cada um seu morto) ou 2x2 (duplas, morto por time)</span>
        </div>

        <div className="hg-list tg-list">
          <section className="tg-section">
            <h3>Baralho e mesa</h3>
            <p>108 cartas: 2 baralhos de 52 + 4 curingões. 11 cartas por jogador.</p>
            <p>Cada time recebe um morto de 11 cartas, guardado à parte. O resto forma o monte.</p>
          </section>

          <section className="tg-section">
            <h3>Seu turno</h3>
            <p>1. Compre 1 carta do monte, <strong>ou</strong> compre o lixo inteiro (só se conseguir usar a carta do topo na hora, formando um jogo novo ou acrescentando a um jogo do seu time).</p>
            <p>2. Baixe jogos novos e/ou acrescente cartas aos jogos do seu time, quantas vezes quiser.</p>
            <p>3. Descarte 1 carta — encerra o turno.</p>
          </section>

          <section className="tg-section">
            <h3>Jogos válidos</h3>
            <p><strong>Sequência:</strong> 3+ cartas do mesmo naipe, em ordem (Ás pode ser alto ou baixo).</p>
            <p><strong>Trinca:</strong> 3+ cartas do mesmo valor, naipes livres.</p>
            <p>O <strong>2</strong> e o <strong>curingão</strong> são curinga — no máximo 1 curinga por jogo (um 2 na posição natural da sequência não conta como curinga).</p>
          </section>

          <section className="tg-section">
            <h3>Canastra</h3>
            <p>Jogo com 7 ou mais cartas.</p>
            <table className="tg-table">
              <tbody>
                <tr><td>Limpa (sem curinga)</td><td>200 pontos</td></tr>
                <tr><td>Suja (com curinga)</td><td>100 pontos</td></tr>
              </tbody>
            </table>
          </section>

          <section className="tg-section">
            <h3>Pontos por carta</h3>
            <table className="tg-table">
              <tbody>
                <tr><td>Ás</td><td>15</td></tr>
                <tr><td>Curingão</td><td>50</td></tr>
                <tr><td>2</td><td>10</td></tr>
                <tr><td>3 a 7</td><td>5</td></tr>
                <tr><td>8 a K</td><td>10</td></tr>
              </tbody>
            </table>
          </section>

          <section className="tg-section">
            <h3>Batida (zerar a mão)</h3>
            <p>Se o time ainda não pegou o morto, ele é entregue na hora (esvaziou baixando jogos) ou no próximo turno do time (esvaziou descartando) — a mão continua.</p>
            <p>Se o time já pegou o morto, zerar a mão encerra a partida ali. O bônus de +100 pontos só vale pra quem bateu com pelo menos uma canastra.</p>
          </section>

          <section className="tg-section">
            <h3>Pontuação final</h3>
            <p>Pontos dos jogos (cartas + bônus de canastra) − cartas que sobraram na mão − 100 se nunca pegou o morto + 100 se bateu com canastra. Vence quem tiver mais pontos.</p>
          </section>
        </div>
      </aside>

      {open && <div className="hand-guide-overlay" onClick={() => setOpen(false)} />}
    </>
  )
}
