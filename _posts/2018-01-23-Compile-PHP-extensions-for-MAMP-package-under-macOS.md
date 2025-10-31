---
layout: post
title: macOS下编译MAMP集成环境包的PHP扩展
---

本人比较懒，一直使用 [MAMP](https://www.mamp.info/en/) 集成环境包作为本地机器的开发环境。最近的一个需求中，需要添加对webp格式图片的支持。

开启MAMP的 [Imagick](http://php.net/manual/en/book.imagick.php) 扩展，发现并不支持webp，决定手工编译下Imagick扩展，使用 [Homebrew](https://brew.sh/) 搞定本地 [ImageMagick](http://www.imagemagick.org/script/index.php) 后，开始编译MAMP的扩展了。

过程比较简单，主要是注意下MAMP的php-config和phpize目录及Homebrew安装的ImageMagick目录。下面步骤记录下也供大家参考：

<!-- more -->

```
	
cd ~/Downloads/imagick-3.4.3

/Applications/MAMP/bin/php/php7.1.8/bin/phpize

export PKG_CONFIG_PATH=/usr/local/opt/imagemagick/lib/pkgconfig/

./configure --with-php-config=/Applications/MAMP/bin/php/php7.1.8/bin/php-config --with-imagick=/usr/local/opt/imagemagick

make && make install

```
