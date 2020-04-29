const webpack = require('webpack');
const path = require('path');

module.exports = {
    entry: ['babel-polyfill', path.join(__dirname, 'client', 'index.js')],
    output: {
        path: path.join(__dirname, 'static'),
        filename: 'bundle.js'
    },
    module: {
        rules: [
            //{test: /\.css/, loader: 'style-loader!css-loader', include: [path.resolve(__dirname, "src")], exclude:path.resolve(__dirname, "node_modules")},
            { test: /\.json$/, loader: 'json-loader', exclude: [path.resolve(__dirname, 'node_modules'), path.resolve(__dirname, 'static/map1.json')] },
            {
                loader: "babel-loader",
                // Skip any files outside of your project's `src` directory
                include: [
                    path.resolve(__dirname, 'common'),
                    path.resolve(__dirname, 'client'),
                    path.resolve(__dirname, 'static')
                ],
                exclude: [path.resolve(__dirname, 'node_modules'),path.resolve(__dirname, 'static/bootstrap.min.js'), path.resolve(__dirname, 'static/jquery-3.3.1.min.js')],
                // Only run `.js` and `.jsx` files through Babel
                test: /\.jsx?$/,
                // Options to configure babel with
                query: {
                    plugins: ['transform-runtime', ["babel-root-slash-import", {"rootPathSuffix": "src"}]],
                    presets: ['es2015', 'react'],
                }
            },
            {
                include: path.resolve(__dirname, 'node_modules/pixi.js'),
                loader: 'transform-loader/cacheable?brfs',
                enforce: 'post'
            }
        ]
    },
    plugins: [
        new webpack.DefinePlugin({
            'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV)
        }),
        new webpack.optimize.OccurrenceOrderPlugin(),
        new webpack.optimize.UglifyJsPlugin({
            compress: { warnings: false },
            mangle: true,
            sourcemap: false,
            beautify: false,
            dead_code: true
        })
    ]
};