/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // 如果你想自定义颜色或字体，可以在这里添加
      // 例如，如果你想用 'bg-brand' 代替具体的颜色值：
      // colors: {
      //   brand: '#4F46E5',
      // }
    },
  },
  plugins: [],
}