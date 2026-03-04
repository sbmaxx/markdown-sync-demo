import React, { useState, useEffect, useRef } from 'react';
import './App.css';

// Один общий markdown-документ + метаданные блоков с точными индексами
const createMockDocument = () => {
  const segments = [];
  let markdown = '';

  const pushSegment = segment => {
    const start = markdown.length;
    const piece = segment.markdown;
    markdown += piece;
    const end = markdown.length - 1;

    let codeOffset = null;
    let labelOffset = null;

    if (segment.type === 'code' && segment.content) {
      const idx = piece.indexOf(segment.content);
      codeOffset = idx >= 0 ? idx : null;
    }

    if (segment.type === 'gallery' && segment.label) {
      const idx = piece.indexOf(segment.label);
      labelOffset = idx >= 0 ? idx : null;
    }

    segments.push({
      id: segment.id,
      type: segment.type,
      content: segment.content,
      label: segment.label,
      start,
      end,
      codeOffset,
      labelOffset
    });
  };

  // Текст до галереи
  pushSegment({
    id: '1',
    type: 'text',
    content: 'Выделите часть этого предложения, чтобы увидеть точность до символа.',
    markdown:
      'Выделите часть этого предложения, чтобы увидеть точность до символа.\n\n'
  });

  // Галерея
  pushSegment({
    id: '2',
    type: 'gallery',
    label: 'Галерея (Блок Markdown)',
    markdown:
      '<!-- gallery start -->\n' +
      '![img1](./image-1)\n' +
      '![img2](./image-2)\n' +
      'Галерея (Блок Markdown)\n' +
      '<!-- gallery end -->\n\n'
  });

  // Пример кода как дополнительный блок
  pushSegment({
    id: '3',
    type: 'code',
    label: 'Пример кода сопоставления',
    content:
      'function mapSelectionToMarkdown(range) {\n' +
      '  const start = toMarkdownIndex(range.startContainer, range.startOffset);\n' +
      '  const end = toMarkdownIndex(range.endContainer, range.endOffset);\n' +
      '  return { start, end };\n' +
      '}',
    markdown:
      '```js\n' +
      'function mapSelectionToMarkdown(range) {\n' +
      '  const start = toMarkdownIndex(range.startContainer, range.startOffset);\n' +
      '  const end = toMarkdownIndex(range.endContainer, range.endOffset);\n' +
      '  return { start, end };\n' +
      '}\n' +
      '```\n\n'
  });

  // Текст после галереи и примера кода
  pushSegment({
    id: '4',
    type: 'text',
    content: 'А теперь выделите текст после галереи. Обратите внимание на индексы!',
    markdown:
      'А теперь выделите текст после галереи.\n' +
      'Обратите внимание на индексы!'
  });

  return { markdown, segments };
};

const { markdown: MOCK_MARKDOWN, segments: MOCK_DATA } = createMockDocument();

const App = () => {
  const [selectedRange, setSelectedRange] = useState(null);
  const [overlayRects, setOverlayRects] = useState([]);
  const [selectedSegments, setSelectedSegments] = useState([]);
  const [hoveredBlockId, setHoveredBlockId] = useState(null);
  const containerRef = useRef(null);

  const renderWithNewlines = (text, keyPrefix) => {
    const parts = text.split('\n');
    const result = [];

    parts.forEach((part, idx) => {
      if (idx > 0) {
        result.push(<br key={`${keyPrefix}-br-${idx}`} />);
      }
      if (part.length > 0) {
        result.push(
          <span key={`${keyPrefix}-seg-${idx}`}>{part}</span>
        );
      }
    });

    return result;
  };

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
        setOverlayRects([]);
        setSelectedRange(null);
        setSelectedSegments([]);
        setHoveredBlockId(null);
        return;
      }

      const inPreview =
        containerRef.current.contains(selection.anchorNode) ||
        containerRef.current.contains(selection.focusNode);

      // Игнорируем выделения вне превью, чтобы подсветка не "прыгала"
      if (!inPreview) {
        setOverlayRects([]);
        setSelectedRange(null);
        setSelectedSegments([]);
        setHoveredBlockId(null);
        return;
      }

      if (selection.isCollapsed) {
        setOverlayRects([]);
        setSelectedRange(null);
        setSelectedSegments([]);
        setHoveredBlockId(null);
        return;
      }

      const range = selection.getRangeAt(0);
      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();
      const scrollTop = container.scrollTop;
      const scrollLeft = container.scrollLeft;
      const blocks = container.querySelectorAll('[data-m-start]');

      let minStart = null;
      let maxEnd = null;
      const rects = [];
      const segments = [];

      const toLocalRect = domRect => ({
        top: domRect.top - containerRect.top + scrollTop,
        left: domRect.left - containerRect.left + scrollLeft,
        width: domRect.width,
        height: domRect.height
      });

      blocks.forEach(block => {
        // Проверяем, попадает ли блок в выделение (полностью или частично)
        if (selection.containsNode(block, true)) {
          const bStart = parseInt(block.dataset.mStart, 10);
          const bEnd = parseInt(block.dataset.mEnd, 10);
          const blockId = block.dataset.mId;
          const codeOffset = parseInt(block.dataset.mCodeOffset || '0', 10);
          const meta = MOCK_DATA.find(node => node.id === blockId);

          let segStart;
          let segEnd;

          if (meta && meta.type === 'gallery') {
            const labelOffset = meta.labelOffset ?? 0;
            const labelElement = block.querySelector('.gallery-label');

            const startInLabel =
              labelElement && labelElement.contains(range.startContainer)
                ? getOffsetInBlock(labelElement, range.startContainer, range.startOffset)
                : null;

            const endInLabel =
              labelElement && labelElement.contains(range.endContainer)
                ? getOffsetInBlock(labelElement, range.endContainer, range.endOffset)
                : null;

            // Если выделение целиком внутри подписи — маппим точный поддиапазон подписи
            if (startInLabel !== null && endInLabel !== null) {
              // Рамку рисуем только вокруг подписи
              rects.push(toLocalRect(labelElement.getBoundingClientRect()));

              segStart = bStart + labelOffset + startInLabel;
              segEnd = bStart + labelOffset + endInLabel;
            } else {
              // Иначе считаем галерею атомарным блоком
              rects.push(toLocalRect(block.getBoundingClientRect()));
              segStart = bStart;
              segEnd = bEnd + 1;
            }
          } else {
            rects.push(toLocalRect(block.getBoundingClientRect()));
            // Определяем, покрывает ли выделение блок целиком
            const blockRange = document.createRange();
            blockRange.selectNodeContents(block);
            const fullyCoversBlock =
              range.compareBoundaryPoints(Range.START_TO_START, blockRange) <= 0 &&
              range.compareBoundaryPoints(Range.END_TO_END, blockRange) >= 0;

            if (fullyCoversBlock) {
              segStart = bStart;
              segEnd = bEnd + 1;
            } else {
            // Частичное пересечение — считаем точные границы внутри блока
            if (block.contains(range.startContainer)) {
              segStart =
                bStart +
                codeOffset +
                getOffsetInBlock(block, range.startContainer, range.startOffset);
            } else {
              segStart = bStart + codeOffset;
            }

            if (block.contains(range.endContainer)) {
              segEnd =
                bStart +
                codeOffset +
                getOffsetInBlock(block, range.endContainer, range.endOffset);
            } else {
              segEnd = bEnd + 1;
            }
          }
          }

          segStart = Math.max(bStart, Math.min(segStart, bEnd + 1));
          segEnd = Math.max(segStart, Math.min(segEnd, bEnd + 1));

          segments.push({
            start: segStart,
            end: segEnd,
            blockId
          });

          minStart = minStart === null ? segStart : Math.min(minStart, segStart);
          maxEnd = maxEnd === null ? segEnd : Math.max(maxEnd, segEnd);
        }
      });

      if (rects.length > 0 && segments.length > 0) {
        setOverlayRects(rects);
        setSelectedSegments(segments);
        setSelectedRange({ start: minStart, end: maxEnd });
      } else {
        setOverlayRects([]);
        setSelectedRange(null);
        setSelectedSegments([]);
      }
    };

    document.addEventListener('selectionchange', handleSelection);
    return () => document.removeEventListener('selectionchange', handleSelection);
  }, []);

  const renderHighlightedMarkdown = () => {
    if (!selectedRange && !selectedSegments.length && !hoveredBlockId) {
      return MOCK_MARKDOWN;
    }

    const elements = [];
    let cursor = 0;

    MOCK_DATA.forEach(node => {
      const blockStart = node.start;
      const blockEnd = node.end + 1;
      const blockText = MOCK_MARKDOWN.slice(blockStart, blockEnd);

      if (cursor < blockStart) {
        const gapText = MOCK_MARKDOWN.slice(cursor, blockStart);
        elements.push(
          <span key={`gap-${cursor}-${blockStart}`}>
            {renderWithNewlines(gapText, `gap-${cursor}-${blockStart}`)}
          </span>
        );
      }

      const blockSegments = selectedSegments
        .filter(seg => seg.blockId === node.id)
        .map(seg => ({
          start: Math.max(0, seg.start - blockStart),
          end: Math.max(0, Math.min(blockText.length, seg.end - blockStart))
        }))
        .filter(seg => seg.end > seg.start)
        .sort((a, b) => a.start - b.start);

      if (!blockSegments.length && hoveredBlockId !== node.id) {
        elements.push(
          <span key={`block-${node.id}`}>
            {renderWithNewlines(blockText, `block-${node.id}`)}
          </span>
        );
      } else {
        const inner = [];
        let idx = 0;

        blockSegments.forEach((seg, i) => {
          if (seg.start > idx) {
            const plain = blockText.slice(idx, seg.start);
            inner.push(
              <span key={`b-${node.id}-plain-${i}`}>
                {renderWithNewlines(plain, `b-${node.id}-plain-${i}`)}
              </span>
            );
          }
          inner.push(
            <span
              key={`b-${node.id}-hi-${i}`}
              className="md-highlight"
            >
              {renderWithNewlines(
                blockText.slice(seg.start, seg.end),
                `b-${node.id}-hi-${i}`
              )}
            </span>
          );
          idx = seg.end;
        });

        if (idx < blockText.length) {
          const tail = blockText.slice(idx);
          inner.push(
            <span key={`b-${node.id}-tail`}>
              {renderWithNewlines(tail, `b-${node.id}-tail`)}
            </span>
          );
        }

        elements.push(
          <span
            key={`block-${node.id}`}
            className={hoveredBlockId === node.id ? 'md-block-frame' : undefined}
          >
            {inner}
          </span>
        );
      }

      cursor = blockEnd;
    });

    if (cursor < MOCK_MARKDOWN.length) {
      const tail = MOCK_MARKDOWN.slice(cursor);
      elements.push(
        <span key={`tail-${cursor}`}>
          {renderWithNewlines(tail, `tail-${cursor}`)}
        </span>
      );
    }

    return elements;
  };

  const handleGalleryClick = (event, node) => {
    event.preventDefault();
    event.stopPropagation();

    const blockEl = event.currentTarget.closest('[data-m-start]');
    if (!blockEl) return;

    const bStart = node.start;
    const bEnd = node.end + 1;

    const rect = blockEl.getBoundingClientRect();
    setOverlayRects([rect]);
    setSelectedRange({ start: bStart, end: bEnd });
    setSelectedSegments([
      {
        start: bStart,
        end: bEnd,
        blockId: node.id
      }
    ]);
  };

  return (
    <div className="app-container">
      <div className="preview-side" ref={containerRef}>
        {MOCK_DATA.map(node => (
          <div
            key={node.id}
            data-m-start={node.start}
            data-m-end={node.end}
            data-m-code-offset={node.codeOffset ?? ''}
            className={`block ${node.type}`}
            data-m-id={node.id}
            onMouseEnter={() => setHoveredBlockId(node.id)}
            onMouseLeave={() => setHoveredBlockId(null)}
          >
            {node.type === 'text' && <p>{node.content}</p>}

            {node.type === 'gallery' && (
              <div
                className="gallery-mock"
                onClick={event => handleGalleryClick(event, node)}
              >
                <div className="img-placeholder">IMG 1</div>
                <div className="img-placeholder">IMG 2</div>
                <div className="gallery-label" style={{ color: '#666' }}>
                  {node.label}
                </div>
              </div>
            )}

            {node.type === 'code' && (
              <pre className="code-mock">
                <code>
                  {node.content}
                </code>
              </pre>
            )}
          </div>
        ))}

        {/* Слой визуальных рамок */}
        {overlayRects.map((r, i) => (
          <div
            key={i}
            className="selection-frame"
            style={{
              top: r.top,
              left: r.left,
              width: r.width,
              height: r.height
            }}
          />
        ))}
      </div>

      <div className="info-side">
        <pre className="markdown-source">
          {renderHighlightedMarkdown()}
        </pre>
      </div>
    </div>
  );
};

export default App;