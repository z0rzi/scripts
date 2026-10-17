import kl, { Color } from "kleur";

type StyleOptions = {
  color?: Color;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};

const ICONS = {
    folder_closed: '⯈',
    folder_open: '⯆',

    settings: '',
    script: '',
    config: '',
    image: '',
    diff: '',
    database: '',
    git: '',
    rss: '',
    page: '',
    archive: '',

    docker: '',
    scss: '',
    html: '',
    css: '',
    markdown: '',
    braces: '',
    javascript: '',
    react: '',
    ruby: '',
    php: '',
    python: '',
    coffee: '',
    c: '',
    cSharp: '',
    h: '',
    hs: '',
    twig: '',
    nix: '',
    lua: '',
    java: '',
    lambda: 'λ',
    mustache: '',
    clj: '',
    cljs: '',
    edn: '',
    scala: '',
    go: '',
    dart: '',
    xul: '',
    vscode: '',
    pl: '',
    fsscript: '',
    rlib: '',
    d: '',
    erl: '',
    ex: '',
    vim: '',
    animate: '',
    photoshop: '',
    ts: '',
    jl: '',
    pp: '',
    vue: '﵂',
    elm: '',
    swift: '',
    latex: 'ﭨ',
    r: 'ﳒ',
};

type Design = {
    icon: string;
    iconColor?: Color;
    textStyle?: StyleOptions;
};

const DESIGNS: { [type: string]: Design & { rxs: RegExp[] } } = {
    //
    // Files exact match
    //
    gitIgnore: {
        icon: ICONS.git,
        textStyle: { color: kl.black, italic: true },
        rxs: [/^\.gitignore$/],
    },
    prettierIgnore: {
        icon: ICONS.settings,
        textStyle: { color: kl.black, italic: true },
        rxs: [/^\.prettierignore$/],
    },
    dockerfile: {
        icon: ICONS.docker,
        iconColor: kl.blue,
        rxs: [/^Dockerfile$/],
    },
    vimrc: {
        icon: ICONS.vim,
        iconColor: kl.green,
        rxs: [/^\.?vimrc$/],
    },

    //
    // Languages specific
    //
    javascript: {
        icon: ICONS.javascript,
        iconColor: kl.red,
        rxs: [/\.js$/],
    },
    typescript: {
        icon: ICONS.javascript,
        iconColor: kl.red,
        rxs: [/\.ts$/],
    },
    react: {
        icon: ICONS.react,
        iconColor: kl.red,
        rxs: [/\.[jt]sx$/],
    },
    python: {
        icon: ICONS.python,
        iconColor: kl.red,
        rxs: [/\.py$/],
    },

    java: {
        icon: ICONS.java,
        iconColor: kl.red,
        rxs: [/\.java$/],
    },

    html: {
        icon: ICONS.html,
        iconColor: kl.yellow,
        rxs: [/\.html/],
    },

    css: {
        icon: ICONS.css,
        iconColor: kl.yellow,
        rxs: [/\.css/],
    },

    scss: {
        icon: ICONS.scss,
        iconColor: kl.yellow,
        rxs: [/\.s[ca]ss/],
    },

    json: {
        icon: ICONS.braces,
        // textStyle: { color: kl.black },
        iconColor: kl.cyan,
        rxs: [/\.json$/],
    },
    yaml: {
        icon: ICONS.page,
        iconColor: kl.cyan,
        // textStyle: { color: kl.black },
        rxs: [/\.ya?ml$/],
    },
    csv: {
        icon: ICONS.page,
        iconColor: kl.cyan,
        rxs: [/\.csv$/, /\.xlsx?$/],
    },
    markdown: {
        icon: ICONS.markdown,
        iconColor: kl.cyan,
        rxs: [/\.md$/],
    },
    vim: {
        icon: ICONS.vim,
        iconColor: kl.green,
        rxs: [/\.vim$/],
    },
    nix: {
        icon: ICONS.nix,
        iconColor: kl.green,
        rxs: [/\.nix$/],
    },

    //
    // General Types
    //
    database: {
        icon: ICONS.database,
        iconColor: kl.yellow,
        rxs: [/\.sql$/, /\.db$/],
    },
    scripts: {
        icon: ICONS.script,
        iconColor: kl.black,
        rxs: [/\.sh$/, /\.ps1$/, /\.bat$/, /\.fish/],
    },
    image: {
        icon: ICONS.image,
        iconColor: kl.green,
        textStyle: { color: kl.black },
        rxs: [/\.(?:png|jpe?g|kra|mp4|kdenlive|ico|svg)$/],
    },
    documents: {
        icon: ICONS.page,
        textStyle: { color: kl.black },
        rxs: [/\.(?:pdf|xls)$/],
    },
    text: {
        icon: ICONS.page,
        textStyle: { color: kl.black },
        rxs: [/\.(?:pdf|xls|txt)$/],
    },
    prettier: {
        icon: ICONS.settings,
        textStyle: { color: kl.black },
        rxs: [/prettier/],
    },
    config: {
        icon: ICONS.settings,
        textStyle: { color: kl.black, italic: true },
        rxs: [/\.(?:conf|snippets)$/],
    },
    archive: {
        icon: ICONS.archive,
        textStyle: { color: kl.black },
        rxs: [/\.(?:zip|tar|gz|rar|7z|xz|bz2|lzma|cab)$/],
    },

    //
    // last priority
    //
    dotFiles: {
        icon: ICONS.settings,
        textStyle: {
            color: kl.black,
            italic: true,
        },
        rxs: [/^\./],
    },
    testFiles: {
        icon: ICONS.settings,
        textStyle: {
            color: kl.black,
            italic: true,
        },
        rxs: [/\.spec$/],
    },
};

export { ICONS };

export function getStyleFor(file: string): Design {
    file = file.replace(/^.*\//, '');

    for (const design of Object.values(DESIGNS))
        if (design.rxs.some(rx => rx.test(file)))
            return {
                icon: design.icon,
                iconColor: design.iconColor,
                textStyle: design.textStyle,
            };

    return {
        icon: '?',
        textStyle: {
            color: kl.black,
            italic: true,
        },
    };
}
