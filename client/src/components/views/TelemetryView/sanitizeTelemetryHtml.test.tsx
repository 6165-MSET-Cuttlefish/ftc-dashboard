import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import sanitizeTelemetryHtml from '@/components/views/TelemetryView/sanitizeTelemetryHtml';

const render = (input: string) =>
  renderToStaticMarkup(<>{sanitizeTelemetryHtml(input)}</>);

describe('dangerous input', () => {
  it('drops img, so onerror never runs', () => {
    expect(render('<img src=x onerror=alert(1)>')).toBe('');
  });

  it('drops script and its contents', () => {
    expect(render('<script>alert(1)</script>')).toBe('');
  });

  it('drops iframe with a javascript: source', () => {
    expect(render('<iframe src="javascript:alert(1)"></iframe>')).toBe('');
  });

  it('drops svg, so onload never runs', () => {
    expect(render('<svg onload=alert(1)></svg>')).toBe('');
  });

  it('drops style elements', () => {
    expect(render('<style>body{display:none}</style>')).toBe('');
  });

  it('styles an anchor like the Driver Station but drops its href', () => {
    // The DS renders an inert blue underlined URLSpan — it never sets a movement method — so the
    // link is never navigable and the javascript: URI never enters the DOM.
    const rendered = render('<a href="javascript:alert(1)">click</a>');

    expect(rendered).toBe('<span class="telemetry-link">click</span>');
    expect(rendered).not.toContain('javascript');
    expect(rendered).not.toContain('href');
  });

  it('drops event handler attributes from allowlisted elements', () => {
    expect(render('<b onclick="alert(1)">hi</b>')).toBe('<b>hi</b>');
  });

  it('drops url() in a background declaration', () => {
    expect(
      render('<span style="background:url(javascript:alert(1))">x</span>'),
    ).toBe('<span>x</span>');
  });

  it('drops expression() in a colour', () => {
    expect(render('<span style="color:expression(alert(1))">x</span>')).toBe(
      '<span>x</span>',
    );
  });

  it('drops a class attribute', () => {
    expect(render('<div class="absolute inset-0">x</div>')).toBe(
      '<div>x</div>',
    );
  });

  // The HTML parser switches to foreign-content rules inside svg and math, where a tag can mean
  // something different than it does in HTML. Since the whole subtree is discarded, none of it can
  // resurface as markup.
  it.each([
    [
      'svg wrapping style',
      '<svg><style><img src=x onerror=alert(1)></style></svg>',
    ],
    ['svg desc', '<svg><desc><img src=x onerror=alert(1)></desc></svg>'],
    [
      'svg foreignObject',
      '<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>',
    ],
    ['uppercase svg', '<SVG ONLOAD=alert(1)></SVG>'],
    [
      'math mglyph',
      '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
    ],
    [
      'math annotation-xml',
      '<math><annotation-xml encoding="text/html"><img src=x onerror=alert(1)>',
    ],
  ])('neutralises foreign content: %s', (_label, input) => {
    expect(render(input)).toBe('');
  });

  it.each([
    ['template', '<template><img src=x onerror=alert(1)></template>'],
    ['noscript', '<noscript><img src=x onerror=alert(1)></noscript>'],
    ['uppercase script', '<SCRIPT>alert(1)</SCRIPT>'],
    ['comment', '<!--<img src=x onerror=alert(1)>-->'],
    ['meta refresh', '<meta http-equiv=refresh content=0;url=http://evil>'],
  ])('neutralises parser-mode trick: %s', (_label, input) => {
    expect(render(input)).toBe('');
  });

  it('escapes rather than parses the contents of raw-text elements', () => {
    expect(render('<plaintext><img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    );
    expect(render('<xmp><b>x</b></xmp>')).toBe('&lt;b&gt;x&lt;/b&gt;');
  });

  it('does not honour a base tag', () => {
    expect(render('<base href="http://evil"><b>x</b>')).toBe('<b>x</b>');
  });

  it.each([
    ['css comment', '<span style="color:red/*x*/">x</span>'],
    ['css variable', '<span style="color:var(--x)">x</span>'],
    ['unicode escape', '<span style="color:\\72 ed">x</span>'],
    ['trailing backslash', '<span style="color:red\\">x</span>'],
    ['right-to-left override', '<font color="‮red">v</font>'],
    ['semicolon in face', '<font face="a;b">v</font>'],
  ])('rejects colour/face bypass: %s', (_label, input) => {
    expect(render(input)).not.toContain('style');
  });

  it('drops background-image while keeping a valid background colour', () => {
    expect(
      render('<span style="background:red;background-image:url(x)">x</span>'),
    ).toBe('<span style="background-color:#ff0000">x</span>');
  });

  it('drops custom properties', () => {
    expect(render('<span style="--x:red;color:#ff0000">x</span>')).toBe(
      '<span style="color:#ff0000">x</span>',
    );
  });
});

describe('supported formatting', () => {
  it('keeps bold', () => {
    expect(render('<b>bold</b>')).toBe('<b>bold</b>');
  });

  it('maps font colour and face onto a span', () => {
    expect(render("<font color='#e37c07' face=monospace>v</font>")).toBe(
      '<span style="color:#e37c07;font-family:monospace">v</span>',
    );
  });

  it('accepts a bare colour name and an uppercase tag', () => {
    expect(render('<FONT COLOR=red>v</FONT>')).toBe(
      '<span style="color:#ff0000">v</span>',
    );
  });

  it('ignores font size, as the Driver Station does', () => {
    expect(render('<font size="7" color="red">v</font>')).toBe(
      '<span style="color:#ff0000">v</span>',
    );
  });

  it('reads the four properties Html.fromHtml reads, per declaration', () => {
    expect(
      render(
        '<span style="color:#ff0000;background-color:#00ff00;text-decoration:line-through">x</span>',
      ),
    ).toBe(
      '<span style="color:#ff0000;background-color:#00ff00;text-decoration:line-through">x</span>',
    );
  });

  it('drops declarations Html.fromHtml ignores', () => {
    expect(render('<span style="color:red;font-size:99px">x</span>')).toBe(
      '<span style="color:#ff0000">x</span>',
    );
  });

  it('renders tt as monospace', () => {
    expect(render('<tt>x</tt>')).toBe(
      '<tt style="font-family:monospace">x</tt>',
    );
  });

  it('keeps line breaks, in either case', () => {
    expect(render('a<br>b<BR/>c')).toBe('a<br/>b<br/>c');
  });

  it('reads a style attribute only on the tags the Driver Station reads it on', () => {
    // AOSP routes p, span and li through startCssStyle; everything else ignores the attribute.
    expect(render('<li style="color:red">x</li>')).toBe(
      '<li style="color:#ff0000">x</li>',
    );
    expect(render('<b style="color:red">x</b>')).toBe('<b>x</b>');
    expect(render('<h1 style="color:red">x</h1>')).toBe('<h1>x</h1>');
    // text-align comes from startBlockElement, so a block element still honours it.
    expect(render('<div style="text-align:center;color:red">x</div>')).toBe(
      '<div style="text-align:center">x</div>',
    );
  });

  it('keeps a trailing line break occupied, however deeply it is nested', () => {
    // A break with nothing after it collapses in a browser, where the Driver Station shows a
    // blank line, so the sanitizer follows it with a non-breaking space.
    expect(render('a<br>')).toBe('a<br/>\u00a0');
    expect(render('a<b>y<br></b>')).toBe('a<b>y<br/></b>\u00a0');
  });

  it('does not pad a break that already has content after it', () => {
    expect(render('a<br>b')).toBe('a<br/>b');
  });

  it('turns newlines into breaks without corrupting markup', () => {
    expect(render('one\ntwo')).toBe('one<br/>two');
    // Rewriting the string before parsing would have mangled this tag.
    expect(render('<font\n  color="red">v</font>')).toBe(
      '<span style="color:#ff0000">v</span>',
    );
  });

  it('keeps lists and headings', () => {
    expect(render('<ul><li>a</li></ul>')).toBe('<ul><li>a</li></ul>');
    expect(render('<h3>t</h3>')).toBe('<h3>t</h3>');
  });

  it('resolves colour names to the values Android uses, not the CSS ones', () => {
    // Color.parseColor makes `green` full brightness; CSS `green` is half that. The official FTC
    // samples use it, so matching the Driver Station here is what teams actually see.
    expect(render('<font color="green">v</font>')).toBe(
      '<span style="color:#00ff00">v</span>',
    );
    expect(render('<font color="gray">v</font>')).toBe(
      '<span style="color:#888888">v</span>',
    );
  });

  it('passes through a colour name Android does not know', () => {
    expect(render('<font color="orange">v</font>')).toBe(
      '<span style="color:orange">v</span>',
    );
  });

  it('honours text-align on a block element but not an inline one', () => {
    expect(render('<div style="text-align:center">x</div>')).toBe(
      '<div style="text-align:center">x</div>',
    );
    expect(render('<span style="text-align:center">x</span>')).toBe(
      '<span>x</span>',
    );
  });

  it('keeps the text of inert containers, as TagSoup does', () => {
    expect(render('<button>press</button>')).toBe('press');
    expect(render('<form><label>name</label></form>')).toBe('name');
    expect(render('<video>fallback</video>')).toBe('fallback');
  });

  it('keeps nested formatting', () => {
    expect(render('<b>a<i>b</i></b>')).toBe('<b>a<i>b</i></b>');
  });
});

describe('text handling', () => {
  it('decodes entities and re-escapes them as text', () => {
    expect(render('a &lt; b &amp; c')).toBe('a &lt; b &amp; c');
  });

  it('escapes a stray angle bracket rather than corrupting the output', () => {
    expect(render('battery > 12')).toBe('battery &gt; 12');
  });

  it('closes an unclosed tag', () => {
    expect(render('<b>unclosed')).toBe('<b>unclosed</b>');
  });

  it('unwraps unknown and unsupported tags but keeps their text', () => {
    expect(render('<table><tr><td>x</td></tr></table>')).toBe('x');
    expect(render('<code>x</code>')).toBe('x');
    expect(render('<blink>x</blink>')).toBe('x');
  });

  it('renders plain text unchanged', () => {
    expect(render('heading 37.5')).toBe('heading 37.5');
  });

  it('truncates oversized input', () => {
    const rendered = render('a'.repeat(20000));
    expect(rendered).toHaveLength(16385);
    expect(rendered.endsWith('…')).toBe(true);
  });

  it('keeps the text of markup nested past the depth limit', () => {
    // Dropping the markup is fine; dropping the text with it would lose telemetry the Driver
    // Station shows.
    const rendered = render('<b>'.repeat(200) + 'DEEP');
    expect(rendered).toContain('DEEP');
  });
});
