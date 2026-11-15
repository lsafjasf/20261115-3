import { roundRect, roundPoly } from "./geometry.js";

// Each icon is a function of the corner radius r, returning an ordered list of
// shapes. Stroke width is intentionally absent: it is applied globally via CSS.
export const ICONS = {
  search: {
    label: "搜索",
    build: () => [
      { tag: "circle", cx: 10.5, cy: 10.5, r: 6.5 },
      { tag: "path", d: "M15.5 15.5L21 21" },
    ],
  },

  home: {
    label: "主页",
    build: (r) => [
      { tag: "path", d: "M3 11.5L12 4L21 11.5" },
      { tag: "path", d: roundRect(5.5, 11, 13, 9, r) },
      { tag: "path", d: "M10.5 20V15.2H13.5V20" },
    ],
  },

  bell: {
    label: "通知",
    build: () => [
      {
        tag: "path",
        d: "M18 9.5C18 14.5 20 16 20 16H4C4 16 6 14.5 6 9.5A6 6 0 0 1 18 9.5Z",
      },
      { tag: "path", d: "M10.5 19.5A1.8 1.8 0 0 0 13.5 19.5" },
    ],
  },

  mail: {
    label: "邮件",
    build: (r) => [
      { tag: "path", d: roundRect(3, 5, 18, 14, r) },
      { tag: "path", d: "M4 7L12 13L20 7" },
    ],
  },

  lock: {
    label: "锁定",
    build: (r) => [
      { tag: "path", d: "M8 10V7.5A4 4 0 0 1 16 7.5V10" },
      { tag: "path", d: roundRect(5, 10, 14, 10, r) },
      { tag: "circle", cx: 12, cy: 15, r: 1.4 },
      { tag: "path", d: "M12 16.4V18" },
    ],
  },

  bookmark: {
    label: "收藏",
    build: (r) => [
      {
        tag: "path",
        d: roundPoly(
          [
            [6, 3.5],
            [18, 3.5],
            [18, 20.5],
            [12, 16.5],
            [6, 20.5],
          ],
          r,
        ),
      },
    ],
  },

  heart: {
    label: "喜欢",
    build: (r) => [
      {
        tag: "path",
        d: roundPoly(
          [
            [12, 20.5],
            [4, 12.5],
            [4, 7.5],
            [7.5, 4.5],
            [12, 8],
            [16.5, 4.5],
            [20, 7.5],
            [20, 12.5],
          ],
          r,
        ),
      },
    ],
  },

  star: {
    label: "评分",
    build: (r) => [
      {
        tag: "path",
        d: roundPoly(
          [
            [12, 3.5],
            [14.5, 9],
            [20.5, 9.7],
            [16, 13.8],
            [17.3, 19.8],
            [12, 16.7],
            [6.7, 19.8],
            [8, 13.8],
            [3.5, 9.7],
            [9.5, 9],
          ],
          r,
        ),
      },
    ],
  },

  settings: {
    label: "设置",
    build: () => {
      const teeth = 8;
      const outer = 9.4;
      const inner = 6.6;
      const points = [];
      for (let i = 0; i < teeth * 2; i++) {
        const angle = (Math.PI * i) / teeth - Math.PI / 2;
        const radius = i % 2 === 0 ? outer : inner;
        points.push([
          Number((12 + radius * Math.cos(angle)).toFixed(2)),
          Number((12 + radius * Math.sin(angle)).toFixed(2)),
        ]);
      }
      return [
        { tag: "path", d: roundPoly(points, 1.1) },
        { tag: "circle", cx: 12, cy: 12, r: 2.6 },
      ];
    },
  },

  user: {
    label: "用户",
    build: () => [
      { tag: "circle", cx: 12, cy: 8.5, r: 3.5 },
      { tag: "path", d: "M5 20C5.8 16.5 8.5 15 12 15C15.5 15 18.2 16.5 19 20" },
    ],
  },

  trash: {
    label: "删除",
    build: (r) => [
      { tag: "path", d: "M4 7H20" },
      { tag: "path", d: "M9.5 7V5.5H14.5V7" },
      { tag: "path", d: roundRect(6, 7, 12, 13, r) },
      { tag: "path", d: "M10 11V16M14 11V16" },
    ],
  },

  download: {
    label: "下载",
    build: (r) => [
      { tag: "path", d: "M12 4V14" },
      { tag: "path", d: "M7.5 10.5L12 15L16.5 10.5" },
      { tag: "path", d: roundRect(4, 17, 16, 3.5, r) },
    ],
  },

};

export const ICON_NAMES = Object.keys(ICONS);
