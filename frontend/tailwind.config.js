/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./App.tsx",
    "./index.tsx",
  ],
  theme: {
    extend: {
      colors: {
        // Brand primary purple
        primary: '#652D8E',

        // Brand neutrals
        surface: '#FFFFFF',
        background: '#FFFFFF',
        grayBrand: '#C7C7C7',
      }
    },
  },
  plugins: [],
  darkMode: 'class',
};
