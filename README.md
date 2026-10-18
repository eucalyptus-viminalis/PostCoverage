# PostCoverage

Checks a Farcaster post against the [Network Code](https://farcaster.xyz/~/code) while you write it. A live bar under the composer turns green when the post is clear, warns about possible post or account charges, and names the commendation the post fits best.

## Install the extension (Chrome, Brave, Edge, Arc)

1. Download `postcoverage-<version>.zip` from the [latest release](../../releases/latest) and unzip it.
2. Open `chrome://extensions` (or `brave://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose the unzipped folder.
4. Open farcaster.xyz and start a cast. The PostCoverage bar appears under the text box.

To update, download the new zip, replace the folder's contents, and click reload on PostCoverage in `chrome://extensions`.

The bar runs a quick keyword estimate as you type. For a full check using the Network Code's own questions, click the extension icon and pick a model:

- **Anthropic API**: paste an API key.
- **OpenAI-compatible**: Ollama, LM Studio, vLLM, OpenRouter or OpenAI. Local Ollama must be started with `OLLAMA_ORIGINS=chrome-extension://*`.

Then click **Ask model** in the bar, or turn on automatic checks when you pause typing.

## Standalone page

`post-check.html` is the same checker as a single page you can open in any browser.

## Updating the rules

```bash
python3 build.py --fetch
```

This pulls the latest Network Code and rebuilds `post-check.html` and `extension/network-code.js`. Reload the extension afterwards.

## Development

- `make test` runs the demo posts in `tests/demo-posts.json` through the keyword check.
- `make package` builds the release zip in `dist/`.
- `make social-preview` renders `assets/social-preview.png` from `assets/social-preview.html`.

Unofficial. Farcaster applies the Network Code with its own model; PostCoverage gives an estimate.

## License

MIT. See [LICENSE](LICENSE).
