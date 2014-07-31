module.exports = function(grunt){
grunt.initConfig({ 


// config start
pkg: grunt.file.readJSON('package.json'),

copy: {
    main: {
	  files: [
	    {expand: true, cwd: 'bower_components/jquery/dist/', src: ['**'], dest: 'vendor/jquery'},
	    {expand: true, cwd: 'bower_components/bootstrap/dist/', src: ['**'], dest: 'vendor/bootstrap'},
		{src: ['bower_components/requirejs/require.js'], dest: 'vendor/requirejs/require.js'}
	  ]
    }
},

uglify: {
	main : {
		files: {
			'vendor/requirejs/require.min.js': ['bower_components/requirejs/require.js']
		}
	}
}
// config end



});

grunt.loadNpmTasks('grunt-contrib-copy');
grunt.loadNpmTasks('grunt-contrib-uglify');
grunt.registerTask('default', ['copy','uglify']);

};