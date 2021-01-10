---
layout: post
title: 关于AJAX跨域进行POST请求的一个新认识
---

今天进行代码review的过程中，看到了这样的一段js:

<!-- more -->

```

  if (name && email && area && phone &&phone && company && site && desc) {
      alert('谢谢订购');
      var data = {
          'name': name,
          'email': email,
          'phone':phone,
          'company':company,
          'site':site,
          'desc':desc
      };
      $.post('http://siteb/send.php',data, function(data){
          if (data == '1') {
              alert('订购成功');
          }else{
              alert('请确认信息喔');
          };
      });
  } else {
      alert('看看有没有漏填的 亲');
  };
  
```

问题出现在siteb,这段js是用于sitea上面的，但是却使用$.post提交到了siteb.跨域了，这个AJAX请求没有完成，所以没有结果的展示。

可是这个请求真的没有完成么？实际上，http://siteb/send.php 已经接收到请求并处理完毕了。。。

那么我对AJAX跨域的理解是：跨域执行 XMLHttpRequest ，Request 是正常发出的，但是无法正确获取 Response。