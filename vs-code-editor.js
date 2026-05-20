/**
 * vs-code-editor.js
 * A code editor component with line numbers and syntax highlighting for Vidyasetu.
 */
class VSCodeEditor {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) throw new Error("Container not found");

    this.language = options.language || "javascript";
    this.placeholder = options.placeholder || "// Write your code here...";

    // Keyword maps for syntax highlighting
    this.keywords = {
      sql: [
        "SELECT",
        "FROM",
        "WHERE",
        "INSERT",
        "INTO",
        "UPDATE",
        "SET",
        "DELETE",
        "CREATE",
        "TABLE",
        "DROP",
        "ALTER",
        "ADD",
        "COLUMN",
        "JOIN",
        "LEFT",
        "RIGHT",
        "INNER",
        "OUTER",
        "ON",
        "AND",
        "OR",
        "NOT",
        "IN",
        "LIKE",
        "BETWEEN",
        "ORDER",
        "BY",
        "GROUP",
        "HAVING",
        "LIMIT",
        "DISTINCT",
        "AS",
        "COUNT",
        "SUM",
        "AVG",
        "MAX",
        "MIN",
        "IS",
        "NULL",
        "VALUES",
        "PRIMARY",
        "KEY",
        "UNIQUE",
        "INDEX",
        "UNION",
        "ALL",
        "EXISTS",
        "CASE",
        "WHEN",
        "THEN",
        "ELSE",
        "END",
        "ASC",
        "DESC",
        "UPPER",
        "LOWER",
      ],
      python: [
        "def",
        "return",
        "if",
        "else",
        "elif",
        "for",
        "while",
        "in",
        "import",
        "from",
        "class",
        "try",
        "except",
        "finally",
        "with",
        "as",
        "yield",
        "lambda",
        "not",
        "and",
        "or",
        "is",
        "None",
        "True",
        "False",
        "print",
        "range",
        "len",
        "int",
        "str",
        "float",
        "list",
        "dict",
        "set",
        "tuple",
        "self",
        "pass",
        "break",
        "continue",
        "raise",
        "global",
        "async",
        "await",
        "open",
        "input",
        "append",
        "split",
        "join",
        "lower",
        "upper",
        "strip",
      ],
      javascript: [
        "const",
        "let",
        "var",
        "function",
        "return",
        "if",
        "else",
        "for",
        "while",
        "do",
        "switch",
        "case",
        "break",
        "continue",
        "new",
        "this",
        "class",
        "extends",
        "import",
        "export",
        "default",
        "from",
        "async",
        "await",
        "try",
        "catch",
        "finally",
        "throw",
        "typeof",
        "instanceof",
        "null",
        "undefined",
        "true",
        "false",
        "console",
        "log",
        "document",
        "window",
        "addEventListener",
        "querySelector",
        "getElementById",
        "map",
        "filter",
        "reduce",
        "forEach",
        "push",
        "pop",
        "includes",
        "Promise",
        "resolve",
        "reject",
        "JSON",
        "parse",
        "stringify",
        "Number",
        "String",
        "Array",
        "Object",
        "setTimeout",
        "setInterval",
      ],
      html: [
        "html",
        "head",
        "body",
        "div",
        "span",
        "p",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "a",
        "img",
        "ul",
        "ol",
        "li",
        "table",
        "tr",
        "td",
        "th",
        "form",
        "input",
        "button",
        "select",
        "option",
        "textarea",
        "nav",
        "section",
        "article",
        "header",
        "footer",
        "main",
        "link",
        "meta",
        "title",
        "script",
        "style",
        "br",
        "hr",
        "label",
        "strong",
        "em",
        "code",
        "pre",
        "class",
        "id",
        "href",
        "src",
        "alt",
        "type",
        "value",
        "name",
        "placeholder",
        "action",
        "method",
        "target",
        "rel",
        "DOCTYPE",
      ],
      css: [
        "color",
        "background",
        "background-color",
        "font-size",
        "font-family",
        "font-weight",
        "margin",
        "padding",
        "border",
        "border-radius",
        "display",
        "flex",
        "grid",
        "position",
        "top",
        "right",
        "bottom",
        "left",
        "width",
        "height",
        "max-width",
        "min-height",
        "text-align",
        "line-height",
        "opacity",
        "z-index",
        "overflow",
        "transition",
        "transform",
        "animation",
        "box-shadow",
        "text-shadow",
        "cursor",
        "none",
        "block",
        "inline",
        "relative",
        "absolute",
        "fixed",
        "center",
        "auto",
        "solid",
        "transparent",
        "inherit",
        "important",
        "hover",
        "focus",
        "active",
        "nth-child",
        "before",
        "after",
        "root",
        "var",
      ],
    };

    this.render();
  }

  render() {
    this.container.innerHTML = `
      <div class="vce-container">
        <div class="vce-header">
          <span class="vce-lang-label">${this.language.toUpperCase()}</span>
          <span>Editor</span>
        </div>
        <div class="vce-body">
          <div class="vce-lines" aria-hidden="true"><div class="vce-line-num">1</div></div>
          <textarea class="vce-textarea" placeholder="${this.placeholder}" spellcheck="false" rows="6"></textarea>
        </div>
        <div class="vce-preview" style="display:none"></div>
      </div>
    `;

    this.textarea = this.container.querySelector(".vce-textarea");
    this.linesEl = this.container.querySelector(".vce-lines");
    this.previewEl = this.container.querySelector(".vce-preview");

    // Handle Tab key
    this.textarea.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const start = this.textarea.selectionStart;
        const end = this.textarea.selectionEnd;
        this.textarea.value =
          this.textarea.value.substring(0, start) +
          "  " +
          this.textarea.value.substring(end);
        this.textarea.selectionStart = this.textarea.selectionEnd = start + 2;
      }
    });

    // Update line numbers and syntax preview on input
    this.textarea.addEventListener("input", () => this._update());
    this.textarea.addEventListener("scroll", () => {
      this.linesEl.scrollTop = this.textarea.scrollTop;
      this.previewEl.scrollTop = this.textarea.scrollTop;
    });
  }

  _update() {
    const lines = this.textarea.value.split("\n");
    // Line numbers
    this.linesEl.innerHTML = lines
      .map((_, i) => `<div class="vce-line-num">${i + 1}</div>`)
      .join("");
    // Sync scroll
    this.linesEl.scrollTop = this.textarea.scrollTop;
  }

  _highlight(code) {
    const kw = this.keywords[this.language] || [];
    let escaped = code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Strings
    escaped = escaped.replace(
      /(["'`])(?:(?!\1|\\).|\\.)*\1/g,
      '<span class="vce-str">$&</span>',
    );
    // Comments
    escaped = escaped.replace(
      /(\/\/.*$|--.*$|#(?!.*{).*$)/gm,
      '<span class="vce-cmt">$&</span>',
    );
    // Numbers
    escaped = escaped.replace(
      /\b(\d+\.?\d*)\b/g,
      '<span class="vce-num">$1</span>',
    );
    // Keywords
    if (kw.length) {
      const re = new RegExp("\\b(" + kw.join("|") + ")\\b", "gi");
      escaped = escaped.replace(re, '<span class="vce-kw">$&</span>');
    }
    return escaped;
  }

  getValue() {
    return this.textarea.value;
  }

  setValue(val) {
    this.textarea.value = val;
    this._update();
  }

  focus() {
    this.textarea.focus();
  }

  setLanguage(lang) {
    this.language = lang;
    const headerLang = this.container.querySelector(".vce-lang-label");
    if (headerLang) headerLang.textContent = lang.toUpperCase();
    this._update();
  }
}
