{ pkgs, lib, config, inputs, ... }:

{

  # https://devenv.sh/packages/
  packages = with pkgs; [ 
    git
    lld
  ];

  languages.rust.enable = true;
  
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24;
    npm.enable = true;
  };

  scripts.setup.exec = ''
    echo "🚀 Setting up Yaak development environment..."
    npm install
    npm run bootstrap
    echo "✅ Setup complete! Run 'npm start' to begin development."
  '';

  enterShell = ''
    echo "📦 Yaak Development Environment"
    echo "================================"
    echo "Node.js: $(node --version)"
    echo "NPM: $(npm --version)"
    echo "Rust: $(rustc --version)"
  '';

  enterTest = ''
    echo "Running tests"
    node --version | grep --color=auto "v20"
    rustc --version | grep --color=auto "rustc"
  '';

  # https://devenv.sh/git-hooks/
  # git-hooks.hooks.shellcheck.enable = true;

  # See full reference at https://devenv.sh/reference/options/
}
