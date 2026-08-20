import type { Preview } from "@storybook/react-vite";
import { mswLoader } from "msw-storybook-addon/csf3";
import "../src/ui/workspace-app.css";

const preview: Preview = {
  parameters: {
    a11y: {
      test: "error",
    },
    controls: {
      expanded: true,
    },
  },
  loaders: [mswLoader()],
};

export default preview;
