const js = require("@eslint/js");
const globals = require("globals");

const blockdropPlugin = {
  rules: {
    "no-inline-ui-copy": {
      meta: {
        type: "problem",
        schema: [],
        messages: {
          inline:
            "Move user-facing copy to js/i18n.js and reference its catalog key.",
        },
      },
      create(context) {
        const source = context.sourceCode;
        const isNonEmptyString = (node) =>
          node?.type === "Literal" &&
          typeof node.value === "string" &&
          node.value.trim() !== "" &&
          !/^[\s\W_]+$/u.test(node.value);
        return {
          ConditionalExpression(node) {
            const test = source.getText(node.test);
            if (
              /language|locale/i.test(test) &&
              (isNonEmptyString(node.consequent) ||
                isNonEmptyString(node.alternate) ||
                node.consequent.type === "TemplateLiteral" ||
                node.alternate.type === "TemplateLiteral")
            ) {
              context.report({ node, messageId: "inline" });
            }
          },
          AssignmentExpression(node) {
            const property = node.left?.property?.name;
            if (
              ["textContent", "innerText"].includes(property) &&
              isNonEmptyString(node.right)
            ) {
              context.report({ node, messageId: "inline" });
            }
          },
          CallExpression(node) {
            const name = node.callee?.name;
            if (
              ["setText", "setLabel", "setPlaceholder"].includes(name) &&
              isNonEmptyString(node.arguments[1]) &&
              node.arguments[1].value !== "username"
            ) {
              context.report({ node, messageId: "inline" });
            }
          },
        };
      },
    },
  },
};

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "screenshots/**",
      "android/**"
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["js/ui.js"],
    plugins: { blockdrop: blockdropPlugin },
    rules: {
      "blockdrop/no-inline-ui-copy": "error",
    },
  },
  {
    files: [
      "server.js",
      "scripts/**/*.js",
      "playwright.config.js",
      "vitest.config.js",
      "eslint.config.js",
    ],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
  },
];
