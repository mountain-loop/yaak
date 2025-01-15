module.exports = {
  plugins: [
    require('@tailwindcss/nesting')(require('postcss-nesting')),
    require('tailwindcss'),
    require('autoprefixer'),
  ]
}
