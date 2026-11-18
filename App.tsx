import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { toJpeg } from 'html-to-image';
import iconTL from './assets/icon-tl.png?inline';
import iconBR from './assets/icon-br.png?inline';

type Layout = 'single' | 'double';
type Pair = { a: string; b: string };

// 색상 A: 배경 · 형광펜 글자 / 색상 B: 일반 글자 · 형광펜 배경 · 모서리 장식
const PRESETS: Pair[] = [
  { a: '#DDF2FF', b: '#203B68' },
  { a: '#40101C', b: '#E2E3E5' },
  { a: '#B5BC70', b: '#1A1D1A' },
];
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const full = (v: string) =>
  v.length === 4 ? '#' + [...v.slice(1)].map((c) => c + c).join('') : v;

const SAMPLE = [
  '문장을 드래그해 선택한 뒤 <b>볼드</b>나 <mark>형광펜</mark>을 눌러 보세요. 글자 단위로 줄이 넘어가므로 단어가 길어도 여백이 남지 않습니다. 서식은 JPG로 저장해도 그대로 유지됩니다.',
  '첫 번째 단락입니다. 이곳에 발췌할 글을 <b>직접 입력</b>하거나 붙여 넣으세요.',
  '두 번째 단락입니다. 배치는 아래 설정에서 <mark>좌우 또는 상하</mark>로 바꿀 수 있습니다.',
];

/* ---------- 선택 영역 서식 ---------- */
function currentRich() {
  const sel = getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const n = range.commonAncestorContainer;
  const el = n instanceof Element ? n : n.parentElement;
  const host = el?.closest<HTMLElement>('[data-rich]');
  return host && !range.collapsed ? { sel, range, host } : null;
}

function toggleBold() {
  if (currentRich()) document.execCommand('bold');
}

function toggleHighlight() {
  const c = currentRich();
  if (!c) return;
  const { sel, range, host } = c;
  const marks = Array.from(host.querySelectorAll('mark')).filter((m) =>
    range.intersectsNode(m),
  );
  if (marks.length) {
    marks.forEach((m) => {
      const p = m.parentNode!;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
    });
  } else {
    const mark = document.createElement('mark');
    mark.appendChild(range.extractContents());
    range.insertNode(mark);
    sel.removeAllRanges();
    const r = document.createRange();
    r.selectNodeContents(mark);
    sel.addRange(r);
  }
  host.normalize();
  host.dispatchEvent(new Event('input', { bubbles: true }));
}

/* ---------- 본문 편집 영역 ---------- */
function Rich({ html, onChange, label }: { html: string; onChange: (h: string) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) ref.current.innerHTML = html;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div
      ref={ref}
      className="rich"
      data-rich
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      aria-label={label}
      onInput={(e) => onChange(e.currentTarget.innerHTML)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          document.execCommand('insertLineBreak');
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      }}
    />
  );
}

/* ---------- 색상 입력 ---------- */
const HEX3 = /^#[0-9a-f]{3}$/i;
const HEX6 = /^#[0-9a-f]{6}$/i;
const withHash = (v: string) => (v.trim().startsWith('#') ? v.trim() : '#' + v.trim());

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const bad = !HEX3.test(withHash(draft)) && !HEX6.test(withHash(draft));
  return (
    <label className="cf">
      <span>{label}</span>
      <i className="chip" style={{ background: value }} />
      <input
        value={draft}
        maxLength={7}
        spellCheck={false}
        autoCapitalize="off"
        placeholder="#RRGGBB"
        className={bad ? 'bad' : ''}
        aria-invalid={bad}
        onChange={(e) => {
          setDraft(e.target.value);
          const h = withHash(e.target.value);
          if (HEX6.test(h)) onChange(h); // 6자리가 완성되면 바로 반영
        }}
        onBlur={() => {
          const h = withHash(draft);
          if (HEX3.test(h)) onChange(full(h)); // 3자리 축약형은 입력을 마치면 확장
          else if (!HEX6.test(h)) setDraft(value);
        }}
      />
    </label>
  );
}

export default function App() {
  const [layout, setLayout] = useState<Layout>('single');
  const [titlePos, setTitlePos] = useState<'left' | 'right'>('left');
  const [dir, setDir] = useState<'row' | 'col'>('row');
  const [title, setTitle] = useState('제목');
  const [sub, setSub] = useState('소제목');
  const [texts, setTexts] = useState(SAMPLE);
  const [mode, setMode] = useState<number | 'custom'>(0);
  const [custom, setCustom] = useState<Pair | null>(null);
  const { a, b } = mode === 'custom' && custom ? custom : PRESETS[mode === 'custom' ? 0 : mode];
  const pickCustom = () => {
    setCustom((c) => c ?? { a, b }); // 처음 선택하면 현재 색에서 시작
    setMode('custom');
  };

  const fitRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [stageH, setStageH] = useState(1300);

  useEffect(() => {
    const fit = fitRef.current!;
    const st = stageRef.current!;
    const update = () => {
      setScale(Math.min(1, fit.clientWidth / st.offsetWidth));
      setStageH(st.offsetHeight);
    };
    const ro = new ResizeObserver(update);
    ro.observe(fit);
    ro.observe(st);
    update();
    return () => ro.disconnect();
  }, []);

  const setText = (i: number) => (h: string) =>
    setTexts((t) => t.map((v, k) => (k === i ? h : v)));
  const keep = (e: MouseEvent) => e.preventDefault(); // 버튼이 선택 영역을 해제하지 않도록

  const exportJpg = async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    getSelection()?.removeAllRanges();
    const node = stageRef.current;
    if (!node) return;
    await Promise.all([document.fonts.load('400 30px Pretendard'), document.fonts.load('700 30px Pretendard')]);
    const url = await toJpeg(node, {
      quality: 0.95,
      pixelRatio: 2,
      backgroundColor: a,
      width: node.offsetWidth,
      height: node.offsetHeight,
      style: { transform: 'none' },
    });
    const link = document.createElement('a');
    link.download = 'excerpt.jpg';
    link.href = url;
    link.click();
  };

  const stageStyle = { '--a': a, '--b': b, transform: `scale(${scale})` } as CSSProperties;

  return (
    <div className="app">
      <header className="bar">
        <button onMouseDown={keep} onClick={toggleBold}><b>B</b> 볼드</button>
        <button onMouseDown={keep} onClick={toggleHighlight}>형광펜</button>
        <button className="primary" onClick={exportJpg}>JPG 저장</button>
      </header>

      <div className="fit" ref={fitRef} style={{ height: stageH * scale }}>
        <div ref={stageRef} className={`stage ${layout}`} style={stageStyle}>
          <i className="corner tl" style={{ '--ic': `url("${iconTL}")` } as CSSProperties} />
          <i className="corner br" style={{ '--ic': `url("${iconBR}")` } as CSSProperties} />

          {layout === 'single' ? (
            <>
              <Rich html={texts[0]} onChange={setText(0)} label="본문" />
              <footer className={`foot ${titlePos}`}>
                <i className="rule" />
                {title && <strong>{title}</strong>}
                {sub && <span>{sub}</span>}
              </footer>
            </>
          ) : (
            <>
              <div className="head">
                {title ? <h1>{title}</h1> : <i />}
                <span>{sub}</span>
              </div>
              <div className={`cols ${dir}`}>
                <Rich html={texts[1]} onChange={setText(1)} label="첫 번째 단락" />
                <Rich html={texts[2]} onChange={setText(2)} label="두 번째 단락" />
              </div>
            </>
          )}
        </div>
      </div>

      <section className="panel">
        <div className="row">
          <span>구조</span>
          <div className="seg">
            <button className={layout === 'single' ? 'on' : ''} onClick={() => setLayout('single')}>1단락</button>
            <button className={layout === 'double' ? 'on' : ''} onClick={() => setLayout('double')}>2단락</button>
          </div>
        </div>
        {layout === 'single' ? (
          <div className="row">
            <span>제목 위치</span>
            <div className="seg">
              <button className={titlePos === 'left' ? 'on' : ''} onClick={() => setTitlePos('left')}>좌측</button>
              <button className={titlePos === 'right' ? 'on' : ''} onClick={() => setTitlePos('right')}>우측</button>
            </div>
          </div>
        ) : (
          <div className="row">
            <span>단락 배치</span>
            <div className="seg">
              <button className={dir === 'row' ? 'on' : ''} onClick={() => setDir('row')}>좌우</button>
              <button className={dir === 'col' ? 'on' : ''} onClick={() => setDir('col')}>상하</button>
            </div>
          </div>
        )}
        <label className="row"><span>제목</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="row"><span>소제목</span><input value={sub} onChange={(e) => setSub(e.target.value)} /></label>

        <div className="colors">
          <span className="lbl">색상</span>
          <div className="swatches" role="radiogroup" aria-label="색상 설정">
            {PRESETS.map((p, i) => (
              <button key={i} role="radio" aria-checked={mode === i} className={`sw ${mode === i ? 'on' : ''}`} onClick={() => setMode(i)}>
                <i className="dot" style={{ background: `linear-gradient(90deg, ${p.a} 50%, ${p.b} 50%)` }} />
                <span>프리셋 {i + 1}</span>
              </button>
            ))}
            <button role="radio" aria-checked={mode === 'custom'} className={`sw ${mode === 'custom' ? 'on' : ''}`} onClick={pickCustom}>
              <i className="dot plus">+</i>
              <span>맞춤 지정</span>
            </button>
          </div>
          {mode === 'custom' && (
            <div className="custom">
              <ColorField label="색상 A (배경)" value={a} onChange={(v) => setCustom({ a: v, b })} />
              <ColorField label="색상 B (글자)" value={b} onChange={(v) => setCustom({ a, b: v })} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
