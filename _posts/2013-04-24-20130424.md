---
layout: post
title: 在 php 5.2.x 下使用composer
---

团队使用的开发框架现在已经基于composer，并使用composer的classloader来进行文件的自动加载，但composer生成后的loader是需要在php 5.3以上才能运行。

为了加大框架的适应性，并可以不改变composer ClassLoader 的使用方式。修改了一下composer 的ClassLoader，适用于 php 5.2.x。

在调用 /vendor/autoload.php 的时候判断一下php版本，载入不同的autoload.php，编写自己的autoload.php进行 /vendor/composer/autoload_namespaces.php, /vendor/composer/autoload_classmap.php 两个文件的载入并返回修改过的loader对象。

下面是代码:

<!-- more -->

```

$loader = new ClassLoader();

$map = require LIB_PATH . '/vendor/composer/autoload_namespaces.php';
foreach ($map as $namespace => $path) {
    $loader->add($namespace, $path);
}

$classMap = require LIB_PATH . '/vendor/composer/autoload_classmap.php';
if ($classMap) {
    $loader->addClassMap($classMap);
}

$loader->register(true);

return $loader;

```

ClassLoader.php - [https://gist.github.com/xuanyan/5450446]()