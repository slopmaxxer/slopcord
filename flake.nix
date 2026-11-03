{
  description = "Slopcord - Discord bot and voice controller for slopbox AI agents";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      eachSystem = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = eachSystem (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.buildNpmPackage {
            pname = "slopcord";
            version = "0.1.0";

            src = pkgs.lib.cleanSourceWith {
              src = self;
              filter = path: type:
                !(builtins.elem (builtins.baseNameOf path) [
                  ".git"
                  "result"
                  "node_modules"
                  ".direnv"
                ]);
            };

            npmDepsHash = "sha256-9NMZpNsQ0zQlt1r+V7xiYXwK/8sybDdp0Rdw7hP5CLs=";

            nativeBuildInputs = [ pkgs.makeWrapper ];

            dontNpmBuild = true;

            doCheck = true;
            checkPhase = ''
              runHook preCheck
              npm test
              runHook postCheck
            '';

            postInstall = ''
              wrapProgram $out/bin/slopcord \
                --prefix PATH : ${pkgs.lib.makeBinPath [
                  pkgs.nodejs
                  pkgs.ffmpeg-headless
                  pkgs.whisper-cpp
                  pkgs.git
                ]}
            '';

            meta = with pkgs.lib; {
              description = "Discord bot and voice assistant to control AI agents (Antigravity, Claude Code, Codex)";
              homepage = "https://github.com/slopmaxxer/slopcord";
              license = licenses.mit;
              maintainers = [ "slop" ];
              platforms = platforms.linux;
            };
          };
        }
      );

      devShells = eachSystem (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              nodejs
              ffmpeg-headless
              whisper-cpp
              git
            ];
          };
        }
      );

      checks = eachSystem (system: {
        slopcord = self.packages.${system}.default;
      });

      hydraJobs = {
        slopcord = eachSystem (system: self.packages.${system}.default);
      };

      nixosModules.default = { config, lib, pkgs, ... }:
        let
          cfg = config.services.slopcord;
        in
        {
          options.services.slopcord = {
            enable = lib.mkEnableOption "Slopcord AI agent Discord bot";

            package = lib.mkOption {
              type = lib.types.package;
              default = self.packages.${pkgs.system}.default;
              description = "The slopcord package to run.";
            };

            user = lib.mkOption {
              type = lib.types.str;
              default = "slop";
              description = "User account under which slopcord runs.";
            };

            group = lib.mkOption {
              type = lib.types.str;
              default = "slop";
              description = "Group under which slopcord runs.";
            };

            configFile = lib.mkOption {
              type = lib.types.path;
              default = "/home/slop/.secrets/discord/config.json";
              description = "Path to the configuration JSON file.";
            };
          };

          config = lib.mkIf cfg.enable {
            systemd.services.slopcord = {
              description = "Slopcord Discord Agent Bot";
              after = [ "network-online.target" ];
              wants = [ "network-online.target" ];
              wantedBy = [ "multi-user.target" ];

              serviceConfig = {
                Type = "simple";
                User = cfg.user;
                Group = cfg.group;
                WorkingDirectory = "/home/${cfg.user}";
                ExecStart = "${cfg.package}/bin/slopcord";
                Restart = "on-failure";
                RestartSec = "10s";

                # Agent CLI tools access
                Environment = [
                  "HOME=/home/${cfg.user}"
                  "LANG=en_US.UTF-8"
                  "LC_ALL=en_US.UTF-8"
                  "PATH=/home/${cfg.user}/.nix-profile/bin:/home/${cfg.user}/.local/bin:/run/current-system/sw/bin:/usr/local/bin:/usr/bin"
                ];
              };
            };
          };
        };
    };
}
