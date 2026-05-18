# InkTales Android APK Wrapper

This Android project creates the installable APK for the InkTales web app.

## What it does

The APK opens the deployed InkTales app URL inside an Android WebView. This is the recommended setup for this project because the main InkTales system uses a Node/Express backend.

## Before building

Edit:

```text
app/src/main/res/values/strings.xml
```

Replace:

```xml
<string name="app_url">https://your-deployed-inktales-link.com/app.html</string>
```

With your real deployed InkTales URL.

## Build

Open this `android/InkTales` folder in Android Studio, then use:

```text
Build > Build Bundle(s) / APK(s) > Build APK(s)
```

The generated debug APK is usually located at:

```text
app/build/outputs/apk/debug/app-debug.apk
```

Rename it to `InkTales.apk` and place it in:

```text
public/downloads/InkTales.apk
```

Then redeploy the website. The company page download button will work at:

```text
/company.html#download
```
