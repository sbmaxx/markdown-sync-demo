import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const createMockDocument = () => {
  const segments = [];
  let markdown = '';

  const pushSegment = segment => {
    const start = markdown.length;
    const piece = segment.markdown;
    markdown += piece;
    const end = markdown.length - 1;

    const visibleText = segment.content || segment.label;
    let contentStart = start;
    let contentEnd = end + 1;

    if (visibleText) {
      const idx = piece.indexOf(visibleText);
      if (idx >= 0) {
        contentStart = start + idx;
        contentEnd = contentStart + visibleText.length;
      }
    }

    segments.push({
      id: segment.id,
      type: segment.type,
      content: segment.content,
      label: segment.label,
      start,
      end,
      contentStart,
      contentEnd
    });
  };

  pushSegment({
    id: '1',
    type: 'text',
    content: 'Выделите часть этого предложения, чтобы увидеть точность до символа.',
    markdown:
      'Выделите часть этого предложения, чтобы увидеть точность до символа.\n\n'
  });

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
      if (idx > 0) result.push(<br key={`${keyPrefix}-br-${idx}`} />);
      if (part.length > 0) {
        result.push(<span key={`${keyPrefix}-seg-${idx}`}>{part}</span>);
      }
    });
    return result;
  };

  const getOffsetInBlock = (root, targetNode, targetOffset) => {
    let currentOffset = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node === targetNode) return currentOffset + targetOffset;
      currentOffset += node.textContent.length;
    }
    return 0;
  };

  // Ближайший предок (или сам элемент) с data-m-start, но НЕ сам блок
  const findInnerAnnotated = (node, block) => {
    let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (el && block.contains(el) && el !== block) {
      if (el.dataset.mStart !== undefined && el.dataset.mStart !== '') return el;
      el = el.parentElement;
    }
    return null;
  };

  const clearState = () => {
    setOverlayRects([]);
    setSelectedRange(null);
    setSelectedSegments([]);
    setHoveredBlockId(null);
  };

  useEffect(() => {
    const handleSelection = () => {
      const selection = window.getSelection();

      if (!selection || !containerRef.current) { clearState(); return; }

      const inPreview =
        containerRef.current.contains(selection.anchorNode) ||
        containerRef.current.contains(selection.focusNode);

      if (!inPreview) { clearState(); return; }
      if (selection.isCollapsed) { clearState(); return; }

      const range = selection.getRangeAt(0);
      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();
      const { scrollTop, scrollLeft } = container;
      const blocks = container.querySelectorAll('[data-m-block]');

      let minStart = null;
      let maxEnd = null;
      const rects = [];
      const segments = [];

      const toLocalRect = r => ({
        top: r.top - containerRect.top + scrollTop,
        left: r.left - containerRect.left + scrollLeft,
        width: r.width,
        height: r.height
      });

      blocks.forEach(block => {
        if (!selection.containsNode(block, true)) return;

        const bStart = parseInt(block.dataset.mStart, 10);
        const bEnd = parseInt(block.dataset.mEnd, 10);
        const blockId = block.dataset.mId;

        const blockRange = document.createRange();
        blockRange.selectNodeContents(block);
        const fullyCoversBlock =
          range.compareBoundaryPoints(Range.START_TO_START, blockRange) <= 0 &&
          range.compareBoundaryPoints(Range.END_TO_END, blockRange) >= 0;

        let segStart, segEnd;
        let startEl = null;
        let endEl = null;

        if (fullyCoversBlock) {
          segStart = bStart;
          segEnd = bEnd + 1;
        } else {
          if (block.contains(range.startContainer)) {
            startEl = findInnerAnnotated(range.startContainer, block);
            if (startEl) {
              segStart = parseInt(startEl.dataset.mStart, 10) +
                getOffsetInBlock(startEl, range.startContainer, range.startOffset);
            } else {
              segStart = bStart;
            }
          } else {
            segStart = bStart;
          }

          if (block.contains(range.endContainer)) {
            endEl = findInnerAnnotated(range.endContainer, block);
            if (endEl) {
              segEnd = parseInt(endEl.dataset.mStart, 10) +
                getOffsetInBlock(endEl, range.endContainer, range.endOffset);
            } else {
              segEnd = bEnd + 1;
            }
          } else {
            segEnd = bEnd + 1;
          }
        }

        // Рамку рисуем вокруг внутреннего элемента, если оба края в нём
        const rectEl =
          startEl && endEl && startEl === endEl
            ? startEl
            : block;

        rects.push(toLocalRect(rectEl.getBoundingClientRect()));

        segStart = Math.max(bStart, Math.min(segStart, bEnd + 1));
        segEnd = Math.max(segStart, Math.min(segEnd, bEnd + 1));

        segments.push({ start: segStart, end: segEnd, blockId });
        minStart = minStart === null ? segStart : Math.min(minStart, segStart);
        maxEnd = maxEnd === null ? segEnd : Math.max(maxEnd, segEnd);
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
            <span key={`b-${node.id}-hi-${i}`} className="md-highlight">
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

    const blockEl = event.currentTarget.closest('[data-m-block]');
    if (!blockEl || !containerRef.current) return;

    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();
    const rect = blockEl.getBoundingClientRect();

    setOverlayRects([{
      top: rect.top - containerRect.top + container.scrollTop,
      left: rect.left - containerRect.left + container.scrollLeft,
      width: rect.width,
      height: rect.height
    }]);
    setSelectedRange({ start: node.start, end: node.end + 1 });
    setSelectedSegments([{
      start: node.start,
      end: node.end + 1,
      blockId: node.id
    }]);
  };

  return (
    <div className="app-container">
      <div className="preview-side" ref={containerRef}>
        {MOCK_DATA.map(node => (
          <div
            key={node.id}
            data-m-block=""
            data-m-start={node.start}
            data-m-end={node.end}
            data-m-id={node.id}
            className={`block ${node.type}`}
            onMouseEnter={() => setHoveredBlockId(node.id)}
            onMouseLeave={() => setHoveredBlockId(null)}
          >
            {node.type === 'text' && (
              <p data-m-start={node.contentStart} data-m-end={node.contentEnd}>
                {node.content}
              </p>
            )}

            {node.type === 'gallery' && (
              <div
                className="gallery-mock"
                onClick={event => handleGalleryClick(event, node)}
              >
                <div className="img-placeholder">IMG 1</div>
                <div className="img-placeholder">IMG 2</div>
                <div
                  className="gallery-label"
                  data-m-start={node.contentStart}
                  data-m-end={node.contentEnd}
                  style={{ color: '#657b83' }}
                >
                  {node.label}
                </div>
              </div>
            )}

            {node.type === 'code' && (
              <pre className="code-mock">
                <code data-m-start={node.contentStart} data-m-end={node.contentEnd}>
                  {node.content}
                </code>
              </pre>
            )}
          </div>
        ))}

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
