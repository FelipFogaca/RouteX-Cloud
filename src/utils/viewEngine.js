const fs = require('fs');
const path = require('path');

function createViewEngine() {
  return function render(filePath, options, callback) {
    try {
      const html = renderFile(filePath, options || {});
      callback(null, html);
    } catch (error) {
      callback(error);
    }
  };
}

function renderFile(filePath, locals) {
  const template = fs.readFileSync(filePath, 'utf8');
  return compile(template, locals, filePath);
}

function compile(template, locals, filePath) {
  let cursor = 0;
  let code = "let __out = '';\nwith (locals) {\n";
  const expression = /<%([=-]?)([\s\S]*?)%>/g;
  let match;

  while ((match = expression.exec(template)) !== null) {
    const text = template.slice(cursor, match.index);
    if (text) code += `__out += ${JSON.stringify(text)};\n`;

    const mode = match[1];
    const body = match[2];
    if (mode === '=') {
      code += `__out += __escape(((${body}) ?? ''));\n`;
    } else if (mode === '-') {
      code += `__out += String(((${body}) ?? ''));\n`;
    } else {
      code += `${body}\n`;
    }
    cursor = match.index + match[0].length;
  }

  const tail = template.slice(cursor);
  if (tail) code += `__out += ${JSON.stringify(tail)};\n`;
  code += '}\nreturn __out;';

  const include = (includePath, extraLocals = {}) => {
    const resolved = resolveInclude(filePath, includePath);
    return renderFile(resolved, { ...locals, ...extraLocals });
  };

  const fn = new Function('locals', 'include', '__escape', code);
  return fn(locals, include, escapeHtml);
}

function resolveInclude(parentFile, includePath) {
  const base = path.resolve(path.dirname(parentFile), includePath);
  const withExtension = path.extname(base) ? base : `${base}.ejs`;
  return withExtension;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { createViewEngine, renderFile };
