#/bin/bash

ES6Dir="src/content"
ES5Dir="src/content-es5"

if [ -d "$ES5Dir" ]; then
  rm -rf $ES5Dir
fi
cp -r $ES6Dir $ES5Dir

HTML_FILES=`find $ES5Dir -type f \( -iname "*index.html" \)`
for file in $HTML_FILES
do
  echo $file
  sed -i 's,src="https://webrtc.github.io/adapter/adapter-latest.js",src="../../../js/adapter.js",g' $file
done

JS_FILES=`find $ES5Dir -type f \( -iname "*.js" \)`
for file in $JS_FILES
do
  echo $file
  # NOTE : I know that getusermedia/getdisplaymedia and datachannel/messaging
  # fail because they have url based imports. Let's ignore those for now
  browserify $file -o $file -t [ babelify ]
done

