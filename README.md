# WebRTC code samples #

This is a repository for the WebRTC Javascript code samples.

It is originally a fork of [https://github.com/webrtc/samples](https://github.com/webrtc/samples), but updated to integrate the [Temasys Plugin](plugin.temasys.io), and work on Internet Explorer and Safari.

Some of the samples use new browser features. They may only work in Chrome Canary, Firefox Beta, Microsoft Edge (available with Windows 10), and latest versions of the [Temasys Plugin](plugin.temasys.io), and may require flags to be set.

All of the samples use [AdapterJS](https://github.com/Temasys/AdapterJS), a shim to insulate apps from spec changes and prefix differences. In fact, the standards and protocols used for WebRTC implementations are highly stable, and there are only a few prefixed names. For full interop information, see [webrtc.org/web-apis/interop](http://www.webrtc.org/web-apis/interop).

In Chrome and Opera, all samples that use `getUserMedia()` must be run from a server. Calling `getUserMedia()` from a file:// URL will work in Firefox and the Temasys Plugin, but fail silently in Chrome and Opera.

[webrtc.org/testing](http://www.webrtc.org/testing) lists command line flags useful for development and testing with Chrome.

For more information about WebRTC, we maintain a list of [WebRTC Resources](https://docs.google.com/document/d/1idl_NYQhllFEFqkGQOLv8KBK8M3EVzyvxnKkHl4SuM8/edit). If you've never worked with WebRTC, we recommend you start with the 2013 Google I/O [WebRTC presentation](http://www.youtube.com/watch?v=p2HzZkd2A40).

Patches and issues welcome! See [CONTRIBUTING](https://github.com/Temasys/Google-WebRTC-Samples/blob/dev/CONTRIBUTING.md) for instructions. All contributors must sign a contributor license agreement before code can be accepted. Please complete the agreement for an [individual](https://developers.google.com/open-source/cla/individual) or a [corporation](https://developers.google.com/open-source/cla/corporate) as appropriate.
The [Developer's Guide](https://bit.ly/webrtcdevguide) for this repo has more information about code style, structure and validation.
Head over to [test/README.md](https://github.com/Temasys/Google-WebRTC-Samples/blob/dev/test/README.md) and get started developing.

## Live samples ##

You can see a live version of these samples at [plugin.temasys.io/demo/](https://plugin.temasys.io/demo/)

