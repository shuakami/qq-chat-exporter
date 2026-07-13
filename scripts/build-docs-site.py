#!/usr/bin/env python3
# Build public/docs/*.html from docs/*.md (fumadocs-flavoured static docs).
import re, shutil
from pathlib import Path
import markdown
from markdown.extensions.toc import TocExtension, slugify_unicode
 
REPO = Path(__file__).resolve().parents[1]
SRC = REPO / 'docs'
OUT = REPO / 'public' / 'docs'
 
PAGES = [
    # (md file, out name, nav title, page title, section)
    ('index.md', 'index.html', '介绍', 'QQ Chat Exporter 文档', '指南'),
    ('guide.md', 'guide.html', '使用手册', '使用手册', '指南'),
    ('linux-deploy.md', 'linux-deploy.html', 'Linux 部署', 'Linux 部署', '部署'),
    ('docker-napcat-deployment.md', 'docker-napcat-deployment.html', 'Docker NapCat 部署', 'Docker NapCat 部署', '部署'),
    ('feedback.md', 'feedback.html', '如何反馈问题', '如何反馈问题', '参与'),
    ('contributing.md', 'contributing.html', '如何贡献', '如何贡献', '参与'),
]
 
CSS = '''
:root{
  --blue:#317CFE; --fg:#18181b; --muted:#71717a; --faint:#a1a1aa;
  --line:rgba(24,24,27,0.07); --code-bg:rgba(24,24,27,0.035);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:88px}
body{
  margin:0; color:var(--fg); background:#fff;
  font-family:Inter,"Noto Sans SC",system-ui,sans-serif;
  font-size:14.5px; line-height:1.8;
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
}
a{color:inherit;text-decoration:none}
 
/* top bar */
.topbar{
  position:fixed; top:0; left:0; right:0; z-index:50; height:60px;
  display:flex; align-items:center; gap:16px; padding:0 40px;
  background:rgba(255,255,255,0.86); backdrop-filter:blur(14px) saturate(1.4);
  -webkit-backdrop-filter:blur(14px) saturate(1.4);
}
.topbar .brand{font-weight:600; font-size:14px; letter-spacing:-0.01em}
.topbar .brand .doc{color:var(--muted); font-weight:400; margin-left:8px}
.topbar .right{margin-left:auto; display:flex; align-items:center; gap:20px; font-size:14px; color:var(--muted); line-height:1}
.topbar .right a{display:inline-flex; align-items:center; height:20px}
.topbar .right a:hover{color:var(--fg)}
.menu-btn{display:none; margin-left:auto; border:0; background:none; padding:8px; cursor:pointer; color:var(--muted)}
 
.shell{display:flex; max-width:1400px; margin:0 auto; padding-top:60px}
 
/* sidebar */
.sidebar{
  position:sticky; top:60px; align-self:flex-start;
  width:240px; flex:none; height:calc(100dvh - 60px); overflow-y:auto;
  padding:40px 24px 48px 40px;
}
.sidebar .sec{font-size:12px; font-weight:500; color:var(--faint); margin:28px 0 8px}
.sidebar .sec:first-child{margin-top:0}
.sidebar a{display:block; padding:4px 0; font-size:13.5px; color:var(--muted)}
.sidebar a:hover{color:var(--fg)}
.sidebar a.active{color:var(--fg); font-weight:500}
 
/* content */
.main{flex:1; min-width:0; display:flex; justify-content:center}
.content{width:100%; max-width:720px; padding:48px 48px 120px}
.content h1{font-size:32px; line-height:1.25; letter-spacing:-0.03em; font-weight:600; margin:0 0 12px}
.content h2{font-size:20px; letter-spacing:-0.02em; font-weight:600; margin:56px 0 14px}
.content h3{font-size:16px; letter-spacing:-0.01em; font-weight:600; margin:36px 0 10px}
.content h4{font-size:14.5px; font-weight:600; margin:28px 0 8px}
.content p{margin:0 0 14px}
.content a{color:var(--fg); text-decoration:underline; text-decoration-color:rgba(24,24,27,0.25); text-underline-offset:3px}
.content a:hover{text-decoration-color:var(--fg)}
.content ul,.content ol{padding-left:20px; margin:0 0 14px}
.content li{margin:4px 0}
.content li::marker{color:var(--faint)}
.content img{max-width:100%; border-radius:10px; border:1px solid var(--line); margin:8px 0 16px; cursor:zoom-in}
.lightbox{position:fixed; inset:0; z-index:100; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.72); cursor:zoom-out; padding:24px; opacity:0; visibility:hidden; transition:opacity .22s ease, visibility .22s}
.lightbox.open{opacity:1; visibility:visible}
.lightbox img{max-width:min(1400px,96vw); max-height:94vh; border-radius:10px; box-shadow:0 8px 40px rgba(0,0,0,.4); transform:scale(.96); transition:transform .22s cubic-bezier(.2,.8,.2,1)}
.lightbox.open img{transform:scale(1)}
.lightbox .lb-close{position:absolute; top:18px; right:22px; width:38px; height:38px; border:0; border-radius:50%; background:rgba(255,255,255,.12); color:#fff; font-size:20px; line-height:1; cursor:pointer; transition:background .15s}
.lightbox .lb-close:hover{background:rgba(255,255,255,.24)}
.content hr{border:0; border-top:1px solid var(--line); margin:40px 0}
.content strong{font-weight:600}
 
/* code */
.content code{
  font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:0.85em; background:var(--code-bg); border-radius:5px; padding:2px 5px;
}
.content pre{
  position:relative; background:#fcfcfc; border:1px solid rgba(24,24,27,.04); border-radius:10px;
  padding:14px 18px; overflow-x:auto; margin:0 0 16px; line-height:1.7;
}
.content pre .copy-btn{
  position:absolute; top:8px; right:8px; width:28px; height:28px;
  display:flex; align-items:center; justify-content:center;
  border:0; border-radius:6px; background:transparent;
  color:#a1a1aa; cursor:pointer; padding:0;
  opacity:0; transition:opacity .15s ease, color .15s ease, background .15s ease;
}
.content pre:hover .copy-btn{opacity:1}
.content pre .copy-btn:hover{color:#52525b}
.content pre .copy-btn.copied{color:#16a34a; opacity:1}
.content pre .copy-btn svg{width:18px; height:18px; display:block}
.content pre .copy-btn .ic{transition:opacity .12s ease, transform .12s cubic-bezier(.16,1,.3,1); transform-origin:center}
.content pre .copy-btn .ic-check{position:absolute; opacity:0; transform:scale(.92)}
.content pre .copy-btn.copied .ic-copy{opacity:0; transform:scale(.92)}
.content pre .copy-btn.copied .ic-check{opacity:1; transform:scale(1)}
.content pre code{background:none;border:0;padding:0;font-size:12.5px}
/* muted syntax palette */
.content pre .k,.content pre .nt{color:#215bd6}
.content pre .s,.content pre .s1,.content pre .s2{color:#0f766e}
.content pre .c,.content pre .c1,.content pre .cm{color:var(--faint)}
.content pre .p,.content pre .o{color:#52525b}
.content pre .mi,.content pre .mf,.content pre .kc{color:#9333ea}

/* tables */
.content table{width:100%; border-collapse:collapse; margin:4px 0 20px; font-size:13.5px}
.content th{text-align:left; font-weight:500; color:var(--muted); border-bottom:1px solid var(--line); padding:8px 12px 8px 0}
.content td{border-bottom:1px solid var(--line); padding:8px 12px 8px 0; vertical-align:top}
.content table code{white-space:nowrap}
 
/* recommended highlight */
.content mark{
  background:rgba(49,124,254,.28); color:inherit;
  border-radius:4px; padding:1px 5px;
}
.content mark code{background:none; padding:0}
.content mark[data-tip]{position:relative; cursor:help}
.content mark[data-tip]::after{
  content:attr(data-tip); position:absolute; left:50%; bottom:calc(100% + 8px);
  transform:translateX(-50%) translateY(3px);
  background:#18181b; color:#fff; font-size:12px; line-height:1; padding:6px 10px;
  border-radius:6px; white-space:nowrap; pointer-events:none;
  opacity:0; visibility:hidden; transition:opacity .15s ease, transform .15s ease, visibility .15s;
}
.content mark[data-tip]::before{
  content:""; position:absolute; left:50%; bottom:calc(100% + 3px);
  transform:translateX(-50%) translateY(3px);
  border:5px solid transparent; border-top-color:#18181b; pointer-events:none;
  opacity:0; visibility:hidden; transition:opacity .15s ease, transform .15s ease, visibility .15s;
}
.content mark[data-tip]:hover::after,.content mark[data-tip]:hover::before{
  opacity:1; visibility:visible; transform:translateX(-50%) translateY(0);
}
 
/* callouts */
.content blockquote{
  margin:0 0 16px; padding:2px 0 2px 18px;
  border-left:2px solid rgba(24,24,27,0.14); color:#52525b;
}
.content blockquote p{margin:0 0 8px}
.content blockquote p:last-child{margin:0}
 
/* details */
.content details{border-top:1px solid var(--line); border-bottom:1px solid var(--line); margin:0 0 16px; padding:0}
.content summary{cursor:pointer; padding:12px 0; font-size:14px; user-select:none; color:var(--fg)}
.content details[open] summary{margin-bottom:8px}
.content details > *:last-child{margin-bottom:16px}
 
/* heading anchors */
.content .h-a{color:inherit; text-decoration:none}
.content .h-a:hover{text-decoration:none}
.content .h-a:hover::after{content:"#"; color:var(--faint); margin-left:8px; font-weight:400}
 
/* footer nav */
.pagenav{display:flex; justify-content:space-between; gap:24px; margin-top:72px; padding-top:24px; border-top:1px solid var(--line); font-size:13.5px}
.pagenav a{color:var(--fg); text-decoration:none}
.pagenav a:hover .lbl{text-decoration:underline; text-underline-offset:3px}
.pagenav .dir{display:block; font-size:12px; color:var(--faint); margin-bottom:2px}
.pagenav .next{margin-left:auto; text-align:right}
 
/* toc */
.toc{
  position:sticky; top:60px; align-self:flex-start;
  width:220px; flex:none; height:calc(100dvh - 60px); overflow-y:auto;
  padding:48px 40px 48px 0; font-size:12.5px;
}
.toc .t{color:var(--faint); font-size:12px; margin-bottom:10px}
.toc a{display:block; color:var(--muted); padding:3px 0; line-height:1.55}
.toc a.d3{padding-left:14px}
.toc a:hover{color:var(--fg)}
.toc a.active{color:var(--fg)}
 
@media(max-width:1160px){ .toc{display:none} }
@media(max-width:860px){
  .topbar{padding:0 20px}
  .sidebar{
    position:fixed; left:0; top:60px; z-index:40; background:#fff;
    transform:translateX(-100%); transition:transform .2s ease;
    box-shadow:0 24px 48px -12px rgba(24,24,27,0.14); padding-left:24px;
  }
  body.nav-open .sidebar{transform:none}
  .menu-btn{display:block}
  .content{padding:36px 20px 96px}
}
'''
 
TEMPLATE = '''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · QQ Chat Exporter</title>
<meta name="description" content="QQ Chat Exporter (QCE) 文档：{title}。免费开源的 QQ 聊天记录导出工具，导出 HTML、JSON、TXT、Excel，支持定时备份、批量导出。">
<meta name="keywords" content="QQ聊天记录导出,QQ Chat Exporter,QCE,QQ备份,QQNT,NapCat,{title}">
<meta name="robots" content="index,follow">
<link rel="icon" href="../favicon.ico">
<link rel="canonical" href="https://shuakami.github.io/qq-chat-exporter/docs/{out_name}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="QQ Chat Exporter">
<meta property="og:title" content="{title} · QQ Chat Exporter">
<meta property="og:description" content="QQ Chat Exporter (QCE) 文档：{title}">
<meta property="og:url" content="https://shuakami.github.io/qq-chat-exporter/docs/{out_name}">
<meta property="og:image" content="https://shuakami.github.io/qq-chat-exporter/docs/images/banner.png">
<meta property="og:locale" content="zh_CN">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title} · QQ Chat Exporter">
<meta name="twitter:description" content="QQ Chat Exporter (QCE) 文档：{title}">
<meta name="twitter:image" content="https://shuakami.github.io/qq-chat-exporter/docs/images/banner.png">
<link rel="preconnect" href="https://fonts.loli.net">
<link rel="preconnect" href="https://gstatic.loli.net" crossorigin>
<link href="https://fonts.loli.net/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Noto+Sans+SC:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="docs.css">
</head>
<body>
<header class="topbar">
  <a class="brand" href="../index.html">QQ Chat Exporter<span class="doc">文档</span></a>
  <span class="right">
    <a href="https://github.com/shuakami/qq-chat-exporter/releases" target="_blank">下载</a>
    <a href="https://github.com/shuakami/qq-chat-exporter" target="_blank">GitHub</a>
  </span>
  <button class="menu-btn" aria-label="菜单" onclick="document.body.classList.toggle('nav-open')">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
  </button>
</header>
<div class="shell">
  <nav class="sidebar">{sidebar}</nav>
  <div class="main"><article class="content">
    <h1>{h1}</h1>
    {body}
    {pagenav}
  </article></div>
  <nav class="toc">{toc}</nav>
</div>
<script>
(function(){{
  var links=[].slice.call(document.querySelectorAll('.toc a'));
  if(!links.length)return;
  var hs=links.map(function(a){{return document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)))}});
  function on(){{
    var i=0;
    for(var j=0;j<hs.length;j++){{if(hs[j]&&hs[j].getBoundingClientRect().top<90)i=j;}}
    links.forEach(function(a,j){{a.classList.toggle('active',j===i)}});
  }}
  addEventListener('scroll',on,{{passive:true}});on();
}})();
(function(){{
  var box=document.createElement('div');box.className='lightbox';
  var big=document.createElement('img');box.appendChild(big);
  var x=document.createElement('button');x.className='lb-close';x.innerHTML='\u2715';x.setAttribute('aria-label','关闭');box.appendChild(x);
  document.body.appendChild(box);
  function close(){{box.classList.remove('open');setTimeout(function(){{if(!box.classList.contains('open'))big.src='';}},240);}}
  box.addEventListener('click',close);x.addEventListener('click',close);
  big.addEventListener('click',function(e){{e.stopPropagation();}});
  addEventListener('keydown',function(e){{if(e.key==='Escape')close();}});
  [].forEach.call(document.querySelectorAll('.content img'),function(img){{
    img.addEventListener('click',function(){{big.src=img.src;box.classList.add('open');}});
  }});
}})();
(function(){{
  var COPY='<svg class="ic ic-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
  var CHECK='<svg class="ic ic-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
  [].forEach.call(document.querySelectorAll('.content pre'),function(pre){{
    var btn=document.createElement('button');
    btn.className='copy-btn';btn.type='button';btn.setAttribute('aria-label','复制代码');
    btn.innerHTML=COPY+CHECK;
    btn.addEventListener('click',function(){{
      var code=pre.querySelector('code');
      var text=(code?code.textContent:pre.textContent).replace(/\\n$/,'');
      (navigator.clipboard?navigator.clipboard.writeText(text):Promise.reject()).catch(function(){{
        var ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);
        ta.select();document.execCommand('copy');document.body.removeChild(ta);
      }}).then(function(){{
        btn.classList.add('copied');
        clearTimeout(btn._t);
        btn._t=setTimeout(function(){{btn.classList.remove('copied');}},1600);
      }});
    }});
    pre.appendChild(btn);
  }});
}})();
</script>
</body>
</html>
'''
 
 
def sidebar_html(active):
    out, cur = [], None
    for md, out_name, nav, _, sec in PAGES:
        if sec != cur:
            out.append(f'<div class="sec">{sec}</div>')
            cur = sec
        cls = ' class="active"' if out_name == active else ''
        out.append(f'<a href="{out_name}"{cls}>{nav}</a>')
    return '\n'.join(out)
 
 
def build():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'docs.css').write_text(CSS)
    # images
    img_src = SRC / 'images'
    if img_src.exists():
        shutil.copytree(img_src, OUT / 'images', dirs_exist_ok=True)
 
    for i, (md_name, out_name, nav, title, sec) in enumerate(PAGES):
        text = (SRC / md_name).read_text()
        # strip a leading '# Title' line (we render our own h1)
        text = re.sub(r'^#\s+.*\n', '', text)
        # md cross links -> html
        for m, o, *_ in PAGES:
            text = text.replace(f']({m})', f']({o})').replace(f']({m}#', f']({o}#')
        mdr = markdown.Markdown(extensions=[
            'extra', 'attr_list', 'md_in_html', 'pymdownx.superfences',
            TocExtension(slugify=slugify_unicode, permalink=False, anchorlink=True, anchorlink_class='h-a'),
        ])
        body = mdr.convert(text)
        # toc from h2/h3
        toc_items = []
        def walk(toks):
            for t in toks:
                if t['level'] in (2, 3):
                    cls = 'd3' if t['level'] == 3 else ''
                    toc_items.append(f'<a class="{cls}" href="#{t["id"]}">{t["name"]}</a>')
                walk(t.get('children', []))
        walk(mdr.toc_tokens)
        toc = ('<div class="t">本页目录</div>' + '\n'.join(toc_items)) if toc_items else ''
 
        nav_parts = []
        if i > 0:
            p = PAGES[i - 1]
            nav_parts.append(f'<a class="prev" href="{p[1]}"><span class="dir">上一篇</span><span class="lbl">{p[2]}</span></a>')
        if i < len(PAGES) - 1:
            n = PAGES[i + 1]
            nav_parts.append(f'<a class="next" href="{n[1]}"><span class="dir">下一篇</span><span class="lbl">{n[2]}</span></a>')
        pagenav = f'<div class="pagenav">{"".join(nav_parts)}</div>' if nav_parts else ''
 
        html = TEMPLATE.format(title=title, h1=title, body=body, out_name=out_name,
                               sidebar=sidebar_html(out_name), toc=toc, pagenav=pagenav)
        (OUT / out_name).write_text(html)
        print('wrote', out_name)
 
 
if __name__ == '__main__':
    build()