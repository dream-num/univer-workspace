// Published 1.0.0 accidentally pins react-dom@19.3.0 as a dependency in these
// two UI packages while declaring React as a peer. This installs a mismatched
// renderer in both Workspace (React 19.2.8) and Agent (React 18.3.1).
// packageExtensions cannot remove a dependency, so repair this metadata here.
// Remove after upstream publishes both packages with react-dom as a peer and
// clean installs, both host typechecks and browser startup pass.
const affected = new Set(["@univerjs-pro/docs-table-ui", "@univerjs-pro/bases-dashboard-ui"]);

module.exports = {
  hooks: {
    readPackage(pkg) {
      if (
        affected.has(pkg.name) &&
        pkg.version === "1.0.0" &&
        pkg.dependencies?.["react-dom"] === "19.3.0"
      ) {
        delete pkg.dependencies["react-dom"];
        pkg.peerDependencies = {
          ...pkg.peerDependencies,
          "react-dom": pkg.peerDependencies.react,
        };
      }
      return pkg;
    },
  },
};
