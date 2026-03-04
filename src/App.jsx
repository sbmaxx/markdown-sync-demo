import React, { useState, useEffect, useRef } from 'react';
import './App.css';

// Имитация данных из парсера Markdown
const MOCK_DATA = [
  {
    id: '1',
    type: 'text',
    content: 'Выделите часть этого предложения, чтобы увидеть точность до символа.',
    start: 0,
    end: 70
  },
  {
    id: '2',
    type: 'gallery',
    start: 71,
    end: 200,
    label: 'Галерея (Блок Markdown)'
  },
  {
    id: '3',
    type: 'text',
    content: 'А теперь выделите текст после галереи. Обратите внимание на индексы!',
    start: 201,
    end: 280
  }
];

// Строим "исходный" markdown так, чтобы индексы из MOCK_DATA
// реально соответствовали символам в этой строке
const buildMarkdownFromMockData = () => {
  const maxIndex = MOCK_DATA.reduce((max, node) => Math.max(max, node.end), 0);
  const chars = new Array(maxIndex + 1).fill(' ');

  MOCK_DATA.forEach(node => {
    let snippet = '';

    if (node.type === 'text') {
      snippet = node.content;
    } else if (node.type === 'gallery') {
      // Для галереи явно отображаем комментарии начала/конца, два изображения и подпись
      const blockLength = node.end - node.start + 1;
      let baseSnippet =
        `<!-- gallery start -->\n` +
        `![img1](./image-1)\n` +
        `![img2](./image-2)\n` +
        `${node.label}\n` +
        `<!-- gallery end -->`;

      if (baseSnippet.length < blockLength) {
        baseSnippet = baseSnippet.padEnd(blockLength, ' ');
      }

      snippet = baseSnippet.slice(0, blockLength);
    }

    for (let i = 0; i < snippet.length; i++) {
      const pos = node.start + i;
      if (pos > node.end) break;
      chars[pos] = snippet[i];
    }
  });

  return chars.join('');
};

const MOCK_MARKDOWN = buildMarkdownFromMockData();

const App = () => {
  const [selectedRange, setSelectedRange] = useState(null);
  const [overlayRects, setOverlayRects] = useState([]);
  const containerRef = useRef(null);

  // Функция подсчета символов внутри DOM-дерева блока до конкретной позиции
  const getOffsetInBlock = (root, targetNode, targetOffset) => {
    let currentOffset = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);

    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node === targetNode) {
        return currentOffset + targetOffset;
      }
      currentOffset += node.textContent.length;
    }
    return 0;
  };

  useEffect(() => {
    const handleSelection = () => {
      const selection = window.getSelection();

      if (!selection || !containerRef.current) {
        return;
      }

      const inPreview =
        containerRef.current.contains(selection.anchorNode) ||
        containerRef.current.contains(selection.focusNode);

      // Игнорируем выделения вне превью, чтобы подсветка не "прыгала"
      if (!inPreview) {
        return;
      }

      if (selection.isCollapsed) {
        setOverlayRects([]);
        setSelectedRange(null);
        return;
      }

      const range = selection.getRangeAt(0);
      const blocks = containerRef.current.querySelectorAll('[data-m-start]');

      let minStart = null;
      let maxEnd = null;
      const rects = [];

      blocks.forEach(block => {
        // Проверяем, попадает ли блок в выделение (полностью или частично)
        if (selection.containsNode(block, true)) {
          const bStart = parseInt(block.dataset.mStart);
          const bEnd = parseInt(block.dataset.mEnd);

          rects.push(block.getBoundingClientRect());

          // Определяем, покрывает ли выделение блок целиком
          const blockRange = document.createRange();
          blockRange.selectNodeContents(block);
          const fullyCoversBlock =
            range.compareBoundaryPoints(Range.START_TO_START, blockRange) <= 0 &&
            range.compareBoundaryPoints(Range.END_TO_END, blockRange) >= 0;

          // Расчет точного начала (если выделение началось в этом блоке)
          if (!fullyCoversBlock && block.contains(range.startContainer)) {
            minStart = bStart + getOffsetInBlock(block, range.startContainer, range.startOffset);
          } else if (minStart === null || bStart < minStart) {
            // Если блок полностью или частично внутри выделения,
            // но старт был раньше – берём начало блока
            minStart = bStart;
          }

          // Расчет точного конца (если выделение закончилось в этом блоке)
          if (!fullyCoversBlock && block.contains(range.endContainer)) {
            maxEnd = bStart + getOffsetInBlock(block, range.endContainer, range.endOffset);
          } else if (maxEnd === null || bEnd > maxEnd) {
            maxEnd = bEnd;
          }
        }
      });

      if (rects.length > 0) {
        setOverlayRects(rects);
        setSelectedRange({ start: minStart, end: maxEnd });
      }
    };

    document.addEventListener('selectionchange', handleSelection);
    return () => document.removeEventListener('selectionchange', handleSelection);
  }, []);

  const renderHighlightedMarkdown = () => {
    if (!selectedRange) {
      return MOCK_MARKDOWN;
    }

    const { start, end } = selectedRange;
    const safeStart = Math.max(0, Math.min(start, MOCK_MARKDOWN.length));
    const safeEnd = Math.max(safeStart, Math.min(end, MOCK_MARKDOWN.length));

    // Находим блок, к которому относится выделение (по центру диапазона)
    const middle = (safeStart + safeEnd) / 2;
    const activeBlock = MOCK_DATA.find(node => middle >= node.start && middle <= node.end);

    if (!activeBlock) {
      return (
        <>
          <span>{MOCK_MARKDOWN.slice(0, safeStart)}</span>
          <span className="md-highlight">
            {MOCK_MARKDOWN.slice(safeStart, safeEnd)}
          </span>
          <span>{MOCK_MARKDOWN.slice(safeEnd)}</span>
        </>
      );
    }

    const blockStart = activeBlock.start;
    const blockEnd = activeBlock.end;

    const beforeBlock = MOCK_MARKDOWN.slice(0, blockStart);
    const blockText = MOCK_MARKDOWN.slice(blockStart, blockEnd);
    const afterBlock = MOCK_MARKDOWN.slice(blockEnd);

    let beforeInner;
    let inner;
    let afterInner;

    if (activeBlock.type === 'gallery') {
      // Для галереи считаем, что "сам текст" — это её label
      const label = activeBlock.label;
      const labelIndex = blockText.indexOf(label);

      if (labelIndex !== -1) {
        beforeInner = blockText.slice(0, labelIndex);
        inner = blockText.slice(labelIndex, labelIndex + label.length);
        afterInner = blockText.slice(labelIndex + label.length);
      } else {
        // Фолбэк: подсвечиваем весь блок
        beforeInner = '';
        inner = blockText;
        afterInner = '';
      }
    } else {
      const innerStart = Math.max(0, safeStart - blockStart);
      const innerEnd = Math.max(innerStart, Math.min(blockText.length, safeEnd - blockStart));

      beforeInner = blockText.slice(0, innerStart);
      inner = blockText.slice(innerStart, innerEnd);
      afterInner = blockText.slice(innerEnd);
    }

    return (
      <>
        <span>{beforeBlock}</span>
        <span className="md-block-frame">
          <span>{beforeInner}</span>
          <span className="md-highlight">{inner}</span>
          <span>{afterInner}</span>
        </span>
        <span>{afterBlock}</span>
      </>
    );
  };

  const handleGalleryDoubleClick = event => {
    // Не даём браузеру "подхватывать" текст под галереей
    event.preventDefault();
    event.stopPropagation();

    const block = event.currentTarget.closest('[data-m-start]');
    if (!block) return;

    const range = document.createRange();
    range.selectNodeContents(block);

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  };

  return (
    <div className="app-container">
      <div className="preview-side" ref={containerRef}>
        <h1>Markdown Renderer</h1>

        {MOCK_DATA.map(node => (
          <div
            key={node.id}
            data-m-start={node.start}
            data-m-end={node.end}
            data-m-type={node.type}
            className={`block ${node.type}`}
          >
            {node.type === 'text' && <p>{node.content}</p>}

            {node.type === 'gallery' && (
              <div className="gallery-mock" onDoubleClick={handleGalleryDoubleClick}>
                <div className="img-placeholder">IMG 1</div>
                <div className="img-placeholder">IMG 2</div>
                <div style={{ color: '#666' }}>{node.label}</div>
              </div>
            )}
          </div>
        ))}

        {/* Слой визуальных рамок */}
        {overlayRects.map((r, i) => (
          <div
            key={i}
            className="selection-frame"
            style={{
              top: r.top + window.scrollY,
              left: r.left + window.scrollX,
              width: r.width,
              height: r.height
            }}
          />
        ))}
      </div>

      <div className="info-side">
        <h2>Markdown Inspector</h2>

        <div className="code-card">
          <div className="code-card-header">
            <span className="code-card-title">Исходный markdown</span>
            {selectedRange && (
              <span className="code-card-subtitle">подсвечен связанный фрагмент</span>
            )}
          </div>
          <pre className="markdown-source">
            {renderHighlightedMarkdown()}
          </pre>
        </div>

        {selectedRange ? (
          <div className="info-card">
            <strong>Диапазон в markdown:</strong>
            <span className="range-display">
              chars: {selectedRange.start} — {selectedRange.end}
            </span>
            <p className="info-caption">
              Выделение на превью слева преобразовано в позицию внутри исходного .md файла.
            </p>
          </div>
        ) : (
          <div className="hint">Выделите фрагмент текста или компонент слева</div>
        )}
      </div>
    </div>
  );
};

export default App;